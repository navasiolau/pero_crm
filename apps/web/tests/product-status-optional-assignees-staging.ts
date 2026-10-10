import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { optionalAssigneesCounts, runOptionalAssigneesAcceptance } from "./product-status-optional-assignees-native-scenario";

async function main() {
  let db: PrismaClient | undefined;
  let phase = "GUARD";
  let result: { status: "PASS"; task: number; revision: string; rolledBack: boolean } | { status: "FAIL"; code: string };
  try {
    const encoded = process.env.CRM_STAGING_BROWSER_INPUT ?? "";
    assert.ok(encoded.length > 0 && encoded.length <= 96 * 1024 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
    const input = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    assert.ok(input && typeof input === "object" && !Array.isArray(input) && input.operation === "prepare");
    assert.ok(typeof input.confirmedStagingRevision === "string" && /^[a-f0-9]{40}$/.test(input.confirmedStagingRevision));
    assert.equal(process.env.S3_BUCKET, "pero-crm-staging");
    db = new PrismaClient({ log: [], errorFormat: "minimal" });
    const rollback = new Error("QA126_STAGING_ROLLBACK");
    let completed = false;
    let before: Awaited<ReturnType<typeof optionalAssigneesCounts>> | undefined;
    try {
      await db.$transaction(async tx => {
        assert.deepEqual(await tx.$queryRaw`SELECT current_database() AS name`, [{ name: "crm" }]);
        phase = "SCENARIO";
        before = (await runOptionalAssigneesAcceptance(tx)).originalCounts;
        completed = true;
        throw rollback;
      }, { maxWait: 10_000, timeout: 60_000 });
    } catch (error) { if (error !== rollback) throw error; }
    assert.ok(completed && before);
    phase = "ROLLBACK";
    assert.deepEqual(await optionalAssigneesCounts(db), before);
    result = { status: "PASS", task: 126, revision: input.confirmedStagingRevision, rolledBack: true };
  } catch {
    process.exitCode = 1;
    result = { status: "FAIL", code: phase === "GUARD" ? "OPTIONAL_ASSIGNEES126_STAGING_GUARD_FAILED" :
      phase === "ROLLBACK" ? "OPTIONAL_ASSIGNEES126_STAGING_ROLLBACK_FAILED" : "OPTIONAL_ASSIGNEES126_STAGING_SCENARIO_FAILED" };
  }
  if (db) await db.$disconnect().catch(() => { process.exitCode = 1; result = { status: "FAIL", code: "OPTIONAL_ASSIGNEES126_STAGING_FINALIZE_FAILED" }; });
  console.log(JSON.stringify(result));
}
void main();
