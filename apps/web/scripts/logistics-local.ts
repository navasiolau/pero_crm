import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "../tests/helpers/local-crm-database";
import { nativeSnapshot, verifiedRollback } from "../tests/helpers/native-acceptance-snapshot";

async function main() {
  assert.ok(process.argv.slice(2).every(arg => arg === "--deploy"), "UNKNOWN_LOGISTICS_LOCAL_ARGUMENT");
  const url = existingLocalCrmDatabaseUrl();
  process.env.DATABASE_URL = url;
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    assert.deepEqual(await db.$queryRaw`SELECT current_database() AS name,current_schema() AS schema`, [{ name: "pero_crm", schema: "public" }]);
    const applied = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations"`;
    assert.ok(applied.every(row => row.finished_at && !row.rolled_back_at), "MIGRATION_HISTORY_INCOMPLETE");
    const names = readdirSync("prisma/migrations", { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
    const pending = names.filter(name => !applied.some(row => row.migration_name === name));
    if (pending.length) {
      assert.deepEqual(pending, ["20261029000100_logistics_ttn_waiver"], "UNRELATED_PENDING_MIGRATION_STOP");
      assert.ok(process.argv.includes("--deploy"), "USE_DEPLOY_FOR_APPROVED_TASK_MIGRATION");
      const before = await nativeSnapshot(db), require = createRequire(import.meta.url);
      assert.ok(readFileSync("prisma/migrations/20261029000100_logistics_ttn_waiver/migration.sql", "utf8").includes('ADD COLUMN "ttnNotRequired"'));
      const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", windowsHide: true });
      process.stdout.write(result.stdout.replaceAll(url, "[DATABASE_URL]"));
      process.stderr.write(result.stderr.replaceAll(url, "[DATABASE_URL]"));
      assert.equal(result.status, 0, "TASK_MIGRATION_FAILED");
      const after = await nativeSnapshot(db);
      for (const [table, rows] of Object.entries(before.snapshot.rows)) if (!["_prisma_migrations", "LogisticsTrip", "LogisticsPosting"].includes(table))
        assert.deepEqual(after.snapshot.rows[table], rows, `MIGRATION_CHANGED_${table}`);
    }
    const baseline = await nativeSnapshot(db), marker = new Error("QA197_EXPECTED_ROLLBACK");
    const { verifyLogisticsTtnWaiverNative } = await import("../tests/helpers/logistics-ttn-native");
    let outcome: unknown;
    await verifiedRollback(async () => {
      try {
        await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
          const run = randomUUID();
          const numberInt = 1_000_000_000 + Number.parseInt(run.replaceAll("-", "").slice(0, 7), 16);
          const actor = await tx.user.create({ data: { name: "Проверка197", email: `${run}@example.invalid`, passwordHash: "QA197_NO_LOGIN", roles: ["PROCUREMENT"] } });
          const client = await tx.client.create({ data: { name: "Синтетический клиент197", phone: "QA197" } });
          const project = await tx.project.create({ data: { title: "Проверка197", number: String(numberInt), numberInt, clientId: client.id, currency: "BYN" } });
          const product = await tx.product.create({ data: { title: "Проверка197", number: `${numberInt}.1`, suffixInt: 1, projectId: project.id, status: "PRODUCTION" } });
          const account = await tx.cashAccount.create({ data: { name: `Проверка197 ${run}`, currency: "BYN" } });
          await tx.payment.create({ data: { cashAccountId: account.id, direction: "INCOME", amount: "1000000", bynAmount: "1000000", currency: "BYN" } });
          outcome = await verifyLogisticsTtnWaiverNative(tx, { actorId: actor.id, projectId: project.id, productId: product.id, cashAccountId: account.id });
          throw marker;
        }, { timeout: 120_000, maxWait: 5_000 });
      } catch (error) { if (error !== marker) throw error; }
    }, async () => assert.deepEqual(await nativeSnapshot(db), baseline, "LOCAL_QA_ROLLBACK_PRESERVATION_FAILED"));
    process.stdout.write(JSON.stringify({ target: "existing-local-5433/pero_crm", outcome, rollbackPreserved: true }) + "\n");
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "LOGISTICS_NATIVE_FAILED"); process.exitCode = 1; });
