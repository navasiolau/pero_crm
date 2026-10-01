import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getEngineeringPreview } from "../src/server/product-stage-pay/preview";

globalThis.fetch = async () => { throw new Error("Внутренний BYN-preview не должен запрашивать FX"); };
const date = new Date("2026-09-01T00:00:00Z");
function reader(settlement: unknown = null, projectCurrency = "BYN") {
  return {
    product: { findUnique: async () => ({ id: "p", projectId: "j", expectedPrice: "1000", project: { currency: projectCurrency },
      works: [{ id: "w", paymentKind: "ENGINEERING", stagePayPoolId: "pool" }],
      stagePayPools: [{ id: "pool", state: settlement ? "SETTLED" : "DRAFT", ratePercent: "5", settlement,
        works: [{ id: "w", paymentKind: "ENGINEERING", stagePayPoolId: "pool", productId: "p", projectId: "j", poolWeightUnits: 1000000, createdAt: date,
          tasks: [{ id: "t", workId: "w", productId: "p", projectId: "j", assigneeId: "u", stageShareUnits: 1000000, createdAt: date }] }] }] }) },
    orgSetting: { findUnique: async () => ({ value: "USD" }) },
  } as unknown as Pick<PrismaClient, "product" | "orgSetting">;
}
test("new draft preview ignores old USD payroll setting and matches the BYN writer", async () => {
  const value = await getEngineeringPreview(reader(), "p");
  assert.equal(value.currency, "BYN"); assert.equal(value.amount, "50.00");
  assert.equal(value.tasks.get("t")?.currency, "BYN");
});
test("settled preview retains frozen EUR currency and original amounts", async () => {
  const value = await getEngineeringPreview(reader({ ratePercentSnapshot: "5", amount: "12.50", payrollCurrency: "EUR",
    shares: [{ taskId: "t", amount: "12.50", bynAmount: "50.00", projectAmount: "50.00" }] }), "p");
  assert.equal(value.currency, "EUR"); assert.equal(value.amount, "12.50");
});
test("foreign unprepared project has no new BYN preview", async () => {
  await assert.rejects(getEngineeringPreview(reader(null, "USD"), "p"), /BYN/);
});

