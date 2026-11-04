// Одноразовая операция №211. Запускается только reviewed production dispatcher.
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { applyProductNumberRepairInTransaction, checkProductNumberRepairInTransaction, rollbackProductNumberRepairInTransaction,
  productNumberRepairBaselineSchema } from "../../src/server/products/number-repair";

const inputSchema = z.object({ mode: z.enum(["check", "apply", "rollback"]), operationId: z.uuid(),
  baseline: productNumberRepairBaselineSchema.optional() }).strict();
// Прочитано 04.11.2026 READ ONLY; владелец выбрал только 1.64 → 1.15, прочие номера сохраняются.
const EXPECTED_SUFFIXES = [2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 61, 62, 63, 64];
const PRODUCT_ID = "cmw1xgkk8001opd01mal0r7ad";
async function main() {
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL ?? ""); } catch { throw Error("PRODUCTION_NUMBER_REPAIR_TARGET_STOP"); }
  if (process.env.PERO_NUMBER_REPAIR_HOST !== "crm" || !/^[a-f0-9]{40}$/.test(process.env.PERO_NUMBER_REPAIR_REVISION ?? "") ||
    target.hostname !== "db" || target.pathname !== "/crm" || process.env.S3_BUCKET !== "pero-crm") throw Error("PRODUCTION_NUMBER_REPAIR_TARGET_STOP");
  const input = inputSchema.parse(JSON.parse(process.env.PERO_NUMBER_REPAIR_INPUT ?? "null"));
  if (input.mode !== "check" && (!input.baseline || input.baseline.projectNumber !== "1" || input.baseline.projectId !== "1" ||
    input.baseline.productId !== PRODUCT_ID || input.baseline.operationId !== input.operationId ||
    JSON.stringify(input.baseline.expectedSuffixes) !== JSON.stringify(EXPECTED_SUFFIXES))) throw Error("PRODUCTION_NUMBER_REPAIR_BASELINE_STOP");
  const db = new PrismaClient();
  try {
    const [identity] = await db.$queryRaw<{ database: string; schema: string; role: string }[]>`SELECT current_database() AS database,current_schema() AS schema,current_user AS role`;
    if (identity.database !== "crm" || identity.schema !== "public" || identity.role !== decodeURIComponent(target.username)) throw Error("PRODUCTION_NUMBER_REPAIR_DATABASE_STOP");
    const result = await db.$transaction(async tx => {
      if (input.mode === "check") {
        const result = await checkProductNumberRepairInTransaction(tx, { projectNumber: "1", operationId: input.operationId, expectedSuffixes: EXPECTED_SUFFIXES });
        if (result.projectId !== "1" || result.productId !== PRODUCT_ID) throw Error("PRODUCTION_NUMBER_REPAIR_PRODUCT_STOP");
        return result;
      }
      return input.mode === "apply" ? applyProductNumberRepairInTransaction(tx, input.baseline) : rollbackProductNumberRepairInTransaction(tx, input.baseline);
    }, { maxWait: 5_000, timeout: 30_000 });
    console.log(JSON.stringify({ status: "PASS", mode: input.mode, revision: process.env.PERO_NUMBER_REPAIR_REVISION, result }));
  } finally { await db.$disconnect(); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : "";
  console.log(JSON.stringify({ status: "STOP", code: /^[A-Z0-9_]{1,120}$/.test(message) ? message : "PRODUCT_NUMBER_REPAIR_FAILED" }));
  process.exitCode = 1;
});
