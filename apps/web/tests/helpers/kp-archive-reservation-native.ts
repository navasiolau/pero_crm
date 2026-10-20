import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { applyArchiveManifest } from "../../src/server/kp/archive/apply";
import { ArchiveImportError, canonical, valueHash, type ArchiveReservationWitness } from "../../src/server/kp/archive/contract";
import { allArchiveObjects, prepareArchiveManifest } from "../../src/server/kp/archive/manifest";
import { archiveCleanupId, archiveOwnedRows, archiveRecoveryReceiptIds, captureArchiveReservationWitness, createArchiveSqlStore } from "../../src/server/kp/archive/prisma-store";
import { archiveFixture } from "./kp-archive-fixture";
import { nativeAcceptanceBinding, type NativeDeclaration } from "./native-acceptance-target";
import { nativeSnapshot } from "./native-acceptance-snapshot";

const snapshot = (client: PoolClient, owned = {}) => nativeSnapshot({ async $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> {
  return (await client.query(sql, args)).rows as T;
} } as Parameters<typeof nativeSnapshot>[0], owned);

/** Только Root: переданный native client уже внутри обязательного внешнего rollback. Ни connect, ни реального S3. */
export async function verifyArchiveReservationNative(client: PoolClient, declaration: NativeDeclaration) {
  assert.equal(declaration.target, "local"); const binding = nativeAcceptanceBinding(declaration);
  assert.deepEqual((await client.query('SELECT current_database() AS database,current_schema() AS schema,current_user AS user,inet_server_port() AS port')).rows,
    [{ database: "pero_crm", schema: "public", user: "pero", port: 5432 }]);
  await client.query("SAVEPOINT qa189_recovery_root"); const before = await snapshot(client);
  let failure: unknown; const cases: string[] = [];
  try {
    const f = archiveFixture(), tag = declaration.runId.replace(/-/g, ""), originalActor = "qa189r_old_" + tag, operator = "qa189r_admin_" + tag;
    f.sourceProfile.public.bucket = "qa189r-public-" + tag; f.sourceProfile.contracts.bucket = "qa189r-private-" + tag;
    f.target.database.containerId = String(binding.identity.containerId);
    const manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), objects = allArchiveObjects(manifest), jobs = [...new Set(objects.map(o => o.jobId))];
    for (const [id, role] of [[originalActor, "DIRECTOR"], [operator, "ADMIN"]]) await client.query('INSERT INTO "User"(id,email,name,"passwordHash",roles,active,"updatedAt") VALUES($1,$2,$3,\'synthetic-non-login-hash\',ARRAY[$4]::"Role"[],true,clock_timestamp() AT TIME ZONE \'UTC\')', [id, id + "@example.invalid", "__qa189r_" + id, role]);
    let sequence = 0; const stack: string[] = [];
    const nested = new Proxy(client, { get(target, key) {
      if (key !== "query") return Reflect.get(target, key);
      return async (sql: string, args?: unknown[]) => {
        if (sql.startsWith("BEGIN ")) { const name = "qa189r_tx_" + ++sequence; stack.push(name); return target.query("SAVEPOINT " + name); }
        if (sql === "COMMIT") { const name = stack.pop(); assert.ok(name); return target.query("RELEASE SAVEPOINT " + name); }
        if (sql === "ROLLBACK") { const name = stack.pop(); assert.ok(name); await target.query("ROLLBACK TO SAVEPOINT " + name); return target.query("RELEASE SAVEPOINT " + name); }
        return target.query(sql, args);
      };
    } });
    const guardTarget = async () => { assert.equal(nativeAcceptanceBinding(declaration).identity.containerId, manifest.target.database.containerId); assert.equal(canonical(f.io.binding()), canonical(manifest.target.storage)); };
    const ordinaryStore = (actorId: string) => createArchiveSqlStore(nested, { actorId, guardTarget, baseline: async (db, current) => (await snapshot(db, archiveOwnedRows(current))).digest });
    const base = { apply: true, reviewedHash: manifest.sha256, deps: f.deps, source: f.source, io: f.io, guardTarget };
    const ensure = f.io.ensure;
    f.io.ensure = async (object, bytes, authorize) => { if (object.role !== "docx") throw Error("native-pause-after-seven-docx"); return ensure(object, bytes, authorize); };
    await assert.rejects(applyArchiveManifest(manifest, { ...base, store: ordinaryStore(originalActor) }), /native-pause-after-seven-docx/);
    assert.equal(f.counters.puts, 7); cases.push("ordinary-director-reserve-seven-verified-docx");
    await client.query('UPDATE "User" SET active=false WHERE id=$1', [originalActor]);
    await assert.rejects(applyArchiveManifest(manifest, { ...base, store: ordinaryStore(operator) }), (e: unknown) => e instanceof ArchiveImportError && e.code === "ARCHIVE_OPERATION_CONFLICT");
    const program = { sourceRevision: declaration.revision, entrySha256: "a".repeat(64) }, capture = () => captureArchiveReservationWitness(nested, manifest, { operatorId: operator, operationId: declaration.runId, program });
    const recoveryStore = (witness: ArchiveReservationWitness) => createArchiveSqlStore(nested, { actorId: operator, guardTarget,
      recovery: { witness, reviewedHash: valueHash(witness), operationId: declaration.runId, programSha256: program.entrySha256 },
      baseline: async (db, current) => (await snapshot(db, archiveOwnedRows(current, declaration.runId))).digest });
    let rejection = 0;
    async function rejects(label: string, mutate: () => Promise<unknown>, code: string, staleWitness = false) {
      const point = "qa189r_case_" + ++rejection; await client.query("SAVEPOINT " + point); const checkpoint = await snapshot(client);
      try {
        const old = staleWitness ? await capture() : undefined; await mutate(); const witness = old ?? await capture();
        await assert.rejects(applyArchiveManifest(manifest, { ...base, store: recoveryStore(witness) }), (e: unknown) => e instanceof ArchiveImportError && e.code === code);
        assert.equal(f.counters.puts, 7); cases.push(label);
      } finally { await client.query("ROLLBACK TO SAVEPOINT " + point); await client.query("RELEASE SAVEPOINT " + point); }
      assert.deepEqual(await snapshot(client), checkpoint);
    }
    await rejects("live-lease-refused", () => client.query('UPDATE "ProposalJob" SET state=\'PROCESSING\',"leaseOwner"=\'foreign-native-claim\',"leaseUntil"=(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\' WHERE id=$1', [jobs[0]]), "ARCHIVE_RECOVERY_OPERATION_ACTIVE");
    await rejects("cleanup-progress-refused", () => client.query('UPDATE "ProposalJob" SET result=\'{"manifest":{}}\'::jsonb WHERE id=$1', [archiveCleanupId(jobs[0])]), "ARCHIVE_RECOVERY_CLEANUP_CHANGED");
    await rejects("foreign-owner-payload-refused", () => client.query('UPDATE "ProposalJob" SET payload=jsonb_set(payload,\'{archiveImport,actorId}\',\'"foreign"\') WHERE id=$1', [jobs[0]]), "ARCHIVE_RECOVERY_OPERATION_CHANGED");
    await rejects("non-admin-operator-refused", () => client.query('UPDATE "User" SET roles=ARRAY[\'DIRECTOR\']::"Role"[] WHERE id=$1', [operator]), "ARCHIVE_ACTOR_FORBIDDEN");
    await rejects("stale-full-row-witness-refused", () => client.query('UPDATE "ProposalMedia" SET "fileName"=\'unexpected-change\' WHERE id=$1', [manifest.proposals[0].media[0].id]), "ARCHIVE_RECOVERY_FAMILY_CHANGED", true);
    await rejects("unexpected-reference-refused", () => client.query('INSERT INTO "ProposalItem"(id,"proposalId",position,state,"createdAt","updatedAt") VALUES($1,$2,1,$3::jsonb,clock_timestamp() AT TIME ZONE \'UTC\',clock_timestamp() AT TIME ZONE \'UTC\')', ["qa189r_item_" + tag, manifest.proposals[0].id, JSON.stringify({ ...manifest.proposals[0].state.items[0], id: "qa189r_item_" + tag })]), "ARCHIVE_RECOVERY_FAMILY_CHANGED");
    const payloads = await client.query('SELECT id,payload,"createdById" FROM "ProposalJob" WHERE id=ANY($1::text[]) ORDER BY id', [jobs]);
    const witness = await capture(); assert.equal(Object.keys(witness.verifiedObjects).length, 7); assert.equal(witness.reservationActorId, originalActor);
    f.io.ensure = async (object, ...args) => { assert.notEqual(object.role, "docx", "verified-DOCX-must-be-GET-only"); return ensure(object, ...args); };
    const applied = await applyArchiveManifest(manifest, { ...base, store: recoveryStore(witness) }); assert.equal(applied.mode, "applied");
    assert.deepEqual((await client.query('SELECT id,payload,"createdById" FROM "ProposalJob" WHERE id=ANY($1::text[]) ORDER BY id', [jobs])).rows, payloads.rows);
    assert.equal((await client.query('SELECT active FROM "User" WHERE id=$1', [originalActor])).rows[0].active, false);
    const ids = archiveRecoveryReceiptIds(manifest, declaration.runId), audits = await client.query('SELECT id,"actorId" FROM "ChangeLog" WHERE id=ANY($1::text[]) ORDER BY id', [Object.values(ids)]);
    assert.equal(audits.rows.length, 2); assert.ok(audits.rows.every(row => row.actorId === operator)); cases.push("inactive-original-new-admin-atomic-recovery-seven-get-only");
    const puts = f.counters.puts, replay = await applyArchiveManifest(manifest, { ...base, store: ordinaryStore(operator) }); assert.equal(replay.mode, "applied");
    if (replay.mode !== "applied") throw Error("native-replay"); assert.equal(replay.replayed, true); assert.deepEqual(replay.created, { proposals: 0, items: 0, settings: 0, docx: 0 }); assert.equal(f.counters.puts, puts); cases.push("ordinary-new-admin-replay-zero-duplicates");
  } catch (error) { failure = error; }
  finally { await client.query("ROLLBACK TO SAVEPOINT qa189_recovery_root"); await client.query("RELEASE SAVEPOINT qa189_recovery_root"); }
  assert.deepEqual(await snapshot(client), before, "ARCHIVE_RECOVERY_NATIVE_FULL_ROLLBACK_REQUIRED"); if (failure) throw failure;
  return { status: "PASSED", cases, wholeDatabaseRollbackVerified: true, sourceAndTarget: "synthetic-memory-only", actualCloudAcceptance: false };
}
