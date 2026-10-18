import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { applyArchiveManifest } from "../../src/server/kp/archive/apply";
import { prepareArchiveManifest } from "../../src/server/kp/archive/manifest";
import { archiveOwnedRows, createArchiveSqlStore } from "../../src/server/kp/archive/prisma-store";
import { canonical } from "../../src/server/kp/archive/contract";
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
    const counts = await client.query<{ proposals: number; items: number; settings: number; docx: number }>('SELECT (SELECT count(*)::int FROM "CommercialProposal" WHERE id=ANY($1::text[]) AND "isArchive" AND "projectId" IS NULL AND "clientId" IS NULL AND "deletedAt" IS NULL) AS proposals,(SELECT count(*)::int FROM "ProposalItem" WHERE "proposalId"=ANY($1::text[]) AND "productId" IS NULL AND position>0) AS items,(SELECT count(*)::int FROM "ProposalContract" WHERE id=ANY($2::text[])) AS settings,(SELECT count(*)::int FROM "ProposalContractVersion" WHERE "contractId"=ANY($2::text[])) AS docx', [manifest.proposals.map(row => row.id), manifest.settings.map(row => row.id)]);
    assert.deepEqual(counts.rows, [{ proposals: 23, items: 189, settings: 6, docx: 7 }]);
    result = { manifestHash: manifest.sha256, counts: counts.rows[0], secondRunZeroDuplicates: true, businessBaselinePreserved: true, sourceAndTargetIO: "synthetic-memory-only", cloudImportAccepted: false };
  } catch (error) { primaryError = error; }
  finally { await client.query("ROLLBACK TO SAVEPOINT qa189_root_guard"); await client.query("RELEASE SAVEPOINT qa189_root_guard"); }
  assert.deepEqual(await snapshot(client), before, "ARCHIVE_NATIVE_FULL_DATABASE_ROLLBACK_REQUIRED");
  if (primaryError) throw primaryError;
  return { ...result as object, wholeDatabaseRollbackVerified: true };
}
