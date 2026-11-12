// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при mismatch.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "../../tests/helpers/local-crm-database";
import { nativeSnapshot, verifiedRollback } from "../../tests/helpers/native-acceptance-snapshot";
import { verifyProductNumberingNative } from "../../tests/helpers/product-numbering-native";
import * as products from "../../src/server/products/core";
import { verifyProposalCompositionNative } from "../../tests/helpers/kp-proposal-native";
import * as proposals from "../../src/server/kp/proposal-core";

async function main() {
  const url = existingLocalCrmDatabaseUrl(), db = new PrismaClient({ datasourceUrl: url });
  const rollback = new Error("QA211_ROLLBACK");
  try {
    const identity = await db.$queryRaw<{ database: string; role: string }[]>`SELECT current_database() AS database,current_user AS role`;
    assert.deepEqual(identity, [{ database: "pero_crm", role: "pero" }], "LOCAL_DATABASE_IDENTITY_STOP");
    const before = await nativeSnapshot(db);
    let result: unknown;
    await verifiedRollback(async () => {
      try {
        await db.$transaction(async tx => {
          const token = randomUUID();
          const user = await tx.user.create({ data: { id: `qa211-${token}`, name: "Проверка211", email: `${token}@example.invalid`, passwordHash: "QA211_NO_LOGIN", roles: ["ADMIN"] } });
          const actor = { id: user.id, name: user.name, roles: user.roles, source: "web" as const };
          result = await verifyProductNumberingNative(tx, actor, products);
          await verifyProposalCompositionNative(tx, actor, proposals, products);
          throw rollback;
        }, { timeout: 90_000, maxWait: 5_000 });
      } catch (error) { if (error !== rollback) throw error; }
    }, async () => assert.deepEqual(await nativeSnapshot(db), before, "LOCAL_DATA_PRESERVATION_STOP"));
    console.log(JSON.stringify({ status: "PASS", result, proposalComposition: "PASS", existingDataPreserved: true, rollback: true }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
