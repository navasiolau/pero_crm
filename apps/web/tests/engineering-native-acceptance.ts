/** Opt-in native PostgreSQL acceptance. All write probes roll back. Never production. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Prisma, PrismaClient } from "@prisma/client";
import { inspectEngineeringLocalTarget, withEngineeringLocalDb } from "./engineering-local-runner.mjs";
import { captureEngineeringOwned, assertEngineeringTriggerSet } from "./engineering-owned-fixtures.mjs";
import { closeEngineeringStageCore, configureEngineeringPool, convertUnpaidWorkToEngineering, prepareEngineeringQuote } from "../src/server/product-stage-pay/core";
import type { DomainActor } from "../src/server/projects/core";
import { inspect } from "node:util";

let proofDirectory: string | undefined;
let phase = "INITIAL_READ_ONLY";

async function main() {
  const directory = realpathSync(process.argv[2]);
  assert.equal(dirname(directory).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(directory.includes("pero-engineering-qa-local-"));
  proofDirectory = directory;
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const target = inspectEngineeringLocalTarget();
  const checks: string[] = [];
  await withEngineeringLocalDb(target, async (db: PrismaClient) => {
    const plugins = await db.plugin.findMany({ where: { enabled: true }, select: { id: true } });
    assert.ok(plugins.every((p) => p.id === "file-stages"), "UNREVIEWED_PLUGIN_STOP");
    const before = await captureEngineeringOwned({ db, target: manifest.target, manifest });
    assert.equal(before.phase, "INITIAL");
    const user = await db.user.findUniqueOrThrow({ where: { id: manifest.managerId }, select: { id: true, name: true, roles: true } });
    const actor: DomainActor = { ...user, source: "web" };
    const sentinel = new Error("EXPECTED_NATIVE_ROLLBACK");
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      async function constraint(label: string, code: string, execute: () => Promise<unknown>) {
        phase = label;
        await tx.$executeRawUnsafe("SAVEPOINT qa_probe");
        let error: unknown;
        try { await execute(); } catch (cause) { error = cause; }
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa_probe");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa_probe");
        assert.ok(error, `${label}_MUST_REJECT`);
        assert.equal((error as Prisma.PrismaClientKnownRequestError).meta?.code, code, label);
        checks.push(label);
      }
      await constraint("negative_task_share", "23514", () => tx.$executeRawUnsafe('UPDATE "Task" SET "stageShareUnits"=-1 WHERE id=$1', manifest.ids.legacyTasks[1]));
      await constraint("incomplete_engineering_work", "23514", () => tx.$executeRawUnsafe('UPDATE "Work" SET "paymentKind"=\'ENGINEERING\' WHERE id=$1', manifest.ids.legacyWork));
      await constraint("unique_product_pool", "23505", () => tx.$executeRawUnsafe('INSERT INTO "ProductStagePayPool" (id,"productId",kind,"updatedAt") SELECT $1,"productId",kind,"updatedAt" FROM "ProductStagePayPool" WHERE id=$2', randomUUID(), manifest.ids.pool));
      phase = "configure_and_convert";
      await configureEngineeringPool(actor, { productId: manifest.ids.product, ratePercent: "5", workWeights: [], expectedPoolRevision: 0 }, tx);
      const current = await tx.productStagePayPool.findUniqueOrThrow({ where: { id: manifest.ids.pool } });
      await convertUnpaidWorkToEngineering(actor, { workId: manifest.ids.legacyWork, poolId: manifest.ids.pool,
        expectedPoolRevision: current.revision, requestId: randomUUID(), poolWeights: [{ workId: manifest.ids.legacyWork, units: 1000000 }],
        taskShares: manifest.ids.legacyTasks.map((taskId: string, i: number) => ({ taskId, units: i === 0 ? 800000 : 200000, expectedRevision: 0 })) }, tx);
      await constraint("conversion_append_only", "P0001", () => tx.$executeRawUnsafe('UPDATE "WorkPaymentConversion" SET "convertedAt"="convertedAt" WHERE "workId"=$1', manifest.ids.legacyWork));
      const pool = await tx.productStagePayPool.findUniqueOrThrow({ where: { id: manifest.ids.pool } });
      const input = { productId: manifest.ids.product, expectedPoolRevision: pool.revision, requestId: randomUUID() };
      const prepared = await prepareEngineeringQuote(manifest.ids.product, tx);
      phase = "incomplete_stage";
      await assert.rejects(() => closeEngineeringStageCore(actor, input, prepared, tx), /выполн|заверш/i);
      assert.equal(await tx.productStageSettlement.count({ where: { poolId: manifest.ids.pool } }), 0);
      checks.push("incomplete_stage_atomic_rejection");
      // Only this owned task, inside the transaction that is unconditionally rolled back.
      await tx.task.update({ where: { id: manifest.ids.legacyTasks[1] }, data: { status: "DONE", doneAt: new Date(), doneById: actor.id } });
      const readyQuote = await prepareEngineeringQuote(manifest.ids.product, tx);
      phase = "native_close";
      const result = await closeEngineeringStageCore(actor, input, readyQuote, tx);
      const settlement = await tx.productStageSettlement.findUniqueOrThrow({ where: { id: result.settlementId } });
      assert.equal(settlement.amount.toString(), "500");
      assert.equal(await tx.payrollEntry.count({ where: { productId: manifest.ids.product, scheme: "PIECE" } }), 0);
      checks.push("native_single_fund_500_no_piece");
      await constraint("settlement_append_only", "P0001", () => tx.$executeRawUnsafe('DELETE FROM "ProductStageSettlement" WHERE id=$1', settlement.id));
      await constraint("payroll_append_only", "P0001", () => tx.$executeRawUnsafe('UPDATE "PayrollEntry" SET amount=amount WHERE "productId"=$1', manifest.ids.product));
      await tx.product.update({ where: { id: manifest.ids.product }, data: { status: "STORAGE" } });
      const replay = await closeEngineeringStageCore(actor, input, null, tx);
      assert.equal(replay.settlementId, result.settlementId); assert.equal(replay.repeated, true);
      assert.equal((await tx.product.findUniqueOrThrow({ where: { id: manifest.ids.product } })).status, "STORAGE");
      checks.push("uuid_replay_after_delivery_no_rewind");
      const triggers = await tx.$queryRawUnsafe(`SELECT c.relname AS table_name,t.tgname,t.tgenabled,t.tgisinternal,t.tgtype,t.tgnargs,t.tgqual::text AS tgqual,nf.nspname AS fnnamespace,p.proname,p.prosrc,p.prosecdef,pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function_definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname='public' AND c.relname IN ('WorkPaymentConversion','ProductStageSettlement','ProductStageSettlementShare','PayrollEntry') AND NOT t.tgisinternal`);
      assertEngineeringTriggerSet(triggers); checks.push("exact_native_trigger_definitions");
      phase = "expected_rollback";
      throw sentinel;
    }, { timeout: 60000, maxWait: 5000 }), (error: unknown) => error === sentinel);
    const after = await captureEngineeringOwned({ db, target: manifest.target, manifest });
    assert.deepEqual(after, before); checks.push("whole_transaction_rollback_preserves_all_rows");
  });
  const result = { status: "PASS", runId: manifest.runId, checks, persistedWrites: 0 };
  const fd = openSync(join(directory, "native-proof.json"), "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(result, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  console.log(JSON.stringify(result));
}
void main().catch((error: unknown) => {
  if (proofDirectory) writeFileSync(join(proofDirectory, `native-failure-${Date.now()}.txt`), inspect(error, { depth: 6 }), { flag: "wx", mode: 0o600 });
  // This test uses only own random IDs, but suppress all native error values regardless.
  console.error(JSON.stringify({ status: "STOP", phase, name: error instanceof Error ? error.name : "Unknown", code: "NATIVE_ACCEPTANCE_FAILED_ROLLED_BACK" })); process.exitCode = 1;
});
