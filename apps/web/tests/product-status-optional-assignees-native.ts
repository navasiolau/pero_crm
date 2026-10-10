import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { optionalAssigneesCounts, runOptionalAssigneesAcceptance } from "./product-status-optional-assignees-native-scenario";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";

let db: PrismaClient | undefined;
async function main() {
  db = new PrismaClient({ datasourceUrl: existingLocalCrmDatabaseUrl(), log: [], errorFormat: "minimal" });
  const rollback = new Error("QA126_ROLLBACK");
  let accepted = false;
  const before = await optionalAssigneesCounts(db);
  try {
    await db.$transaction(async tx => {
      assert.deepEqual(await tx.$queryRaw`SELECT current_database() AS name`, [{ name: "pero_crm" }]);
      await runOptionalAssigneesAcceptance(tx);
      accepted = true;
      throw rollback;
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.ok(accepted);
  assert.deepEqual(await optionalAssigneesCounts(db), before);
  console.log(JSON.stringify({ status: "PASS", task: 126, rolledBack: true }));
}
void main().catch(() => { process.exitCode = 1; console.log(JSON.stringify({ status: "FAIL", code: "OPTIONAL_ASSIGNEES126_LOCAL_FAILED" })); })
  .finally(() => db?.$disconnect().catch(() => { process.exitCode = 1; }));
