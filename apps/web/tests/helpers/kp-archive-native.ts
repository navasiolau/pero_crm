import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { applyArchiveManifest } from "../../src/server/kp/archive/apply";
import { prepareArchiveManifest } from "../../src/server/kp/archive/manifest";
import { archiveOwnedRows, createArchiveSqlStore } from "../../src/server/kp/archive/prisma-store";
import { canonical, valueHash, type ArchiveManifest, type TargetProfile } from "../../src/server/kp/archive/contract";
import { normalizeImportedProposals, parseImportedProposalNormalization, readImportedProposalNormalizationEntry, type ImportedProposalNormalization } from "../../src/server/kp/archive/normalize";
import { nativeAcceptanceBinding, type NativeDeclaration } from "./native-acceptance-target";
import { nativeSnapshot } from "./native-acceptance-snapshot";
import { archiveFixture } from "./kp-archive-fixture";

const snapshot = (db: PoolClient, owned = {}) => {
  const adapter = { async $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T> { return (await db.query(sql, values)).rows as T; } };
  return nativeSnapshot(adapter as Parameters<typeof nativeSnapshot>[0], owned);
};

/** Root-only: настоящий SQL с synthetic source и памятью вместо S3; live import/документы этим не принимаются. */
export async function verifyArchiveNative(client: PoolClient, declaration: NativeDeclaration) {
  assert.equal(declaration.target, "local", "ARCHIVE_NATIVE_EXISTING_LOCAL_ONLY");
  const binding = nativeAcceptanceBinding(declaration);
  const identity = await client.query<{ database: string; schema: string; user: string; port: number }>('SELECT current_database() AS database,current_schema() AS schema,current_user AS user,inet_server_port() AS port');
  assert.deepEqual(identity.rows, [{ database: "pero_crm", schema: "public", user: "pero", port: 5432 }], "ARCHIVE_NATIVE_DATABASE_IDENTITY_REQUIRED");
  // Вне BEGIN завершается ошибкой до первой записи; в finally откатывается весь собственный scope.
  await client.query("SAVEPOINT qa189_root_guard");
  const before = await snapshot(client);
  let primaryError: unknown, result: unknown;
  try {
    const fixture = archiveFixture(), runTag = declaration.runId.replace(/-/g, "");
    fixture.sourceProfile.public.bucket = "qa189-public-" + runTag;
    fixture.sourceProfile.contracts.bucket = "qa189-private-" + runTag;
    fixture.target.database.containerId = String(binding.identity.containerId);
    const manifest = await prepareArchiveManifest(fixture.source, fixture.target, fixture.deps, fixture.links);
    const actorId = "qa189_" + declaration.runId;
    await client.query('INSERT INTO "User"(id,email,name,"passwordHash",roles,active,"updatedAt") VALUES($1,$2,$3,\'synthetic-non-login-hash\',ARRAY[\'ADMIN\']::"Role"[],true,clock_timestamp() AT TIME ZONE \'UTC\')', [actorId, `qa189-${runTag}@example.invalid`, "__qa189_" + declaration.runId]);
    let step = 0; const stack: string[] = [];
    // Store использует короткие tx; savepoints сохраняют их реальный SQL внутри обязательного root rollback.
    const nested = new Proxy(client, { get(target, key) {
      if (key !== "query") return Reflect.get(target, key);
      return async (sql: string, parameters?: unknown[]) => {
        if (sql.startsWith("BEGIN ")) { const name = "qa189_step_" + ++step; stack.push(name); return target.query("SAVEPOINT " + name); }
        if (sql === "COMMIT") { const name = stack.pop(); assert.ok(name); return target.query("RELEASE SAVEPOINT " + name); }
        if (sql === "ROLLBACK") { const name = stack.pop(); assert.ok(name); await target.query("ROLLBACK TO SAVEPOINT " + name); return target.query("RELEASE SAVEPOINT " + name); }
        return target.query(sql, parameters);
      };
    } });
    const guardTarget = async () => {
      const actual = nativeAcceptanceBinding(declaration);
      assert.equal(actual.identity.containerId, manifest.target.database.containerId, "ARCHIVE_NATIVE_CONTAINER_CHANGED");
      assert.equal(canonical(fixture.io.binding()), canonical(manifest.target.storage));
    };
    const store = createArchiveSqlStore(nested, { actorId, guardTarget, baseline: async (tx, current) => (await snapshot(tx, archiveOwnedRows(current))).digest });
    const options = { apply: true, reviewedHash: manifest.sha256, deps: fixture.deps, source: fixture.source, io: fixture.io, store, guardTarget };
    await applyArchiveManifest(manifest, options);
    const puts = fixture.counters.puts, replay = await applyArchiveManifest(manifest, options);
    assert.equal(replay.mode, "applied"); if (replay.mode !== "applied") throw Error("ARCHIVE_NATIVE_APPLIED_REQUIRED");
    assert.equal(replay.replayed, true); assert.deepEqual(replay.created, { proposals: 0, items: 0, settings: 0, docx: 0 }); assert.equal(fixture.counters.puts, puts);
    const counts = await client.query<{ proposals: number; items: number; settings: number; docx: number }>('SELECT (SELECT count(*)::int FROM "CommercialProposal" WHERE id=ANY($1::text[]) AND NOT "isArchive" AND "projectId" IS NULL AND "clientId" IS NULL AND "deletedAt" IS NULL) AS proposals,(SELECT count(*)::int FROM "ProposalItem" WHERE "proposalId"=ANY($1::text[]) AND "productId" IS NULL AND position>0) AS items,(SELECT count(*)::int FROM "ProposalContract" WHERE id=ANY($2::text[])) AS settings,(SELECT count(*)::int FROM "ProposalContractVersion" WHERE "contractId"=ANY($2::text[])) AS docx', [manifest.proposals.map(row => row.id), manifest.settings.map(row => row.id)]);
    assert.deepEqual(counts.rows, [{ proposals: 23, items: 189, settings: 6, docx: 7 }]);
    result = { manifestHash: manifest.sha256, counts: counts.rows[0], secondRunZeroDuplicates: true, businessBaselinePreserved: true, sourceAndTargetIO: "synthetic-memory-only", cloudImportAccepted: false };
  } catch (error) { primaryError = error; }
  finally { await client.query("ROLLBACK TO SAVEPOINT qa189_root_guard"); await client.query("RELEASE SAVEPOINT qa189_root_guard"); }
  assert.deepEqual(await snapshot(client), before, "ARCHIVE_NATIVE_FULL_DATABASE_ROLLBACK_REQUIRED");
  if (primaryError) throw primaryError;
  return { ...result as object, wholeDatabaseRollbackVerified: true };
}

/** Root-only native plan: настоящие SELECT под внешним write tx/rollback, без подмены current_setting или runtime capture guards. */
export async function prepareImportedProposalNormalizationNative(client: PoolClient, declaration: NativeDeclaration, manifest: ArchiveManifest, input: {
  target: TargetProfile; operatorId: string; mapping: { proposalId: string; projectId: string }[];
}) {
  const bound = nativeAcceptanceBinding(declaration), database = input.target.database;
  assert.equal(database.kind, declaration.target); assert.equal(database.containerId, declaration.target === "local" ? bound.identity.containerId : bound.identity.database);
  await client.query("SAVEPOINT qa189_normalize_plan_guard"); await client.query("RELEASE SAVEPOINT qa189_normalize_plan_guard");
  const proposals = [];
  for (const mapping of [...input.mapping].sort((a, b) => a.proposalId.localeCompare(b.proposalId, "en"))) {
    const source = manifest.proposals.find(row => row.id === mapping.proposalId); assert.ok(source);
    proposals.push(await readImportedProposalNormalizationEntry(client, source, mapping.projectId));
  }
  return parseImportedProposalNormalization({ schema: 1, kind: "KP_IMPORTED_PROPOSAL_NORMALIZATION", manifestHash: manifest.sha256,
    target: input.target, operatorId: input.operatorId, operationId: declaration.runId, proposals }, manifest);
}

/** Root-only на 23 КП: plan снят отдельной реальной RR READ ONLY либо native builder выше. Ни source, ни S3 не вызываются. */
export async function verifyImportedProposalNormalizationNative(client: PoolClient, declaration: NativeDeclaration, manifest: ArchiveManifest, input: ImportedProposalNormalization) {
  const plan = parseImportedProposalNormalization(input, manifest);
  assert.equal(plan.target.database.kind, declaration.target, "KP_NORMALIZATION_NATIVE_TARGET_CHANGED");
  assert.equal(plan.operationId, declaration.runId, "KP_NORMALIZATION_NATIVE_OPERATION_CHANGED");
  const guardTarget = async () => {
    const bound = nativeAcceptanceBinding(declaration), database = plan.target.database;
    assert.equal(database.containerId, declaration.target === "local" ? bound.identity.containerId : bound.identity.database, "KP_NORMALIZATION_NATIVE_CONTAINER_CHANGED");
    if (declaration.target === "staging") assert.equal(database.revision, declaration.revision);
  };
  await guardTarget();
  await client.query("SAVEPOINT qa189_normalization_root_guard");
  const before = await snapshot(client);
  let step = 0, primaryError: unknown, result: unknown; const stack: string[] = [];
  const nested = new Proxy(client, { get(target, key) {
    if (key !== "query") return Reflect.get(target, key);
    return async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith("BEGIN ")) { const name = "qa189_normalize_step_" + ++step; stack.push(name); return target.query("SAVEPOINT " + name); }
      if (sql === "COMMIT") { const name = stack.pop(); assert.ok(name); return target.query("RELEASE SAVEPOINT " + name); }
      if (sql === "ROLLBACK") { const name = stack.pop(); assert.ok(name); await target.query("ROLLBACK TO SAVEPOINT " + name); return target.query("RELEASE SAVEPOINT " + name); }
      return target.query(sql, parameters);
    };
  } });
  try {
    const options = { reviewedHash: valueHash(plan), guardTarget, baseline: async (tx: PoolClient, owned: Parameters<typeof snapshot>[1]) => (await snapshot(tx, owned)).digest };
    const applied = await normalizeImportedProposals(nested, manifest, plan, options);
    assert.equal(applied.replayed, false);
    const after = await snapshot(client), replay = await normalizeImportedProposals(nested, manifest, plan, options);
    assert.equal(replay.replayed, true); assert.deepEqual(await snapshot(client), after, "KP_NORMALIZATION_REPLAY_MUST_NOT_WRITE");
    const store = createArchiveSqlStore(nested, { actorId: plan.operatorId, guardTarget, baseline: async tx => (await snapshot(tx)).digest });
    const reconciliation = await store.reconcile(manifest);
    assert.equal(reconciliation.published, true); assert.equal(reconciliation.proposals, 23);
    result = { planHash: valueHash(plan), proposals: applied.proposals, linkedItems: applied.linkedItems, metadataOnly: true,
      replayZeroWrites: true, originalImportReconciliationAccepted: true, businessAndMediaBaselinePreserved: true, sourceAndTargetIO: "none" };
  } catch (error) { primaryError = error; }
  finally { await client.query("ROLLBACK TO SAVEPOINT qa189_normalization_root_guard"); await client.query("RELEASE SAVEPOINT qa189_normalization_root_guard"); }
  assert.deepEqual(await snapshot(client), before, "KP_NORMALIZATION_NATIVE_FULL_ROLLBACK_REQUIRED");
  if (primaryError) throw primaryError;
  return { ...result as object, wholeDatabaseRollbackVerified: true };
}
