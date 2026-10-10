import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { runLogisticsCashAcceptance } from "./logistics-cash-native-scenario";

if (!process.env.DATABASE_URL) process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5433" && url.pathname === "/pero_crm", "LOCAL_TARGET_GUARD");
const db = new PrismaClient(), rollback = new Error("QA124_ROLLBACK");
async function main() {
  let accepted = false;
  const before = { payments: await db.payment.count(), postings: await db.logisticsPosting.count(), trips: await db.logisticsTrip.count() };
  try {
    await db.$transaction(async tx => {
      assert.deepEqual(await tx.$queryRaw`SELECT current_database() AS name`, [{ name: "pero_crm" }]);
      const result = await runLogisticsCashAcceptance(tx);
      console.log(`QA124 scenario passed: ${result.assertions}`);
      accepted = true;
      throw rollback;
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.ok(accepted);
  assert.deepEqual({ payments: await db.payment.count(), postings: await db.logisticsPosting.count(), trips: await db.logisticsTrip.count() }, before);
  console.log("QA124 PASS: all owned DB changes rolled back; no physical files or historical money changed");
}
main().finally(() => db.$disconnect());
