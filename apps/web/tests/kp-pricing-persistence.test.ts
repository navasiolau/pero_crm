import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { applyProjectionInTransaction, type ProposalPricingContext } from "../src/server/kp/pricing-persistence";
import { projectProposalPricing } from "../src/server/kp/pricing";

const rate = { currency: "BYN", value: "1", date: "2026-10-18", source: "NBRB" };
const context: ProposalPricingContext = { proposalId: "cp", project: { id: "p", stage: "LEAD", currency: "BYN" },
  items: [{ id: "item", productId: "product" }], actor: { id: "manager", name: "Менеджер", roles: ["MANAGER"], source: "web" } };
function fixture(stage = "LEAD", linked = true) {
  const product = { id: "product", quantity: 3, initialPrice: new Prisma.Decimal("999"), expectedPrice: new Prisma.Decimal("999"), initialPriceCaptureEligible: false };
  const project = { id: "p", stage, currency: "BYN", initialPrice: new Prisma.Decimal("2997"), servicesTotal: null,
    delivery: null, unloading: null, installation: null, proposalRoundingAdjustment: new Prisma.Decimal(0) };
  const history = [{ id: "payroll", amount: "100.00", priceSnapshot: "999.00", currency: "BYN" }];
  const writes: string[] = [];
  const logs: unknown[] = [];
  const tx = { $queryRaw: async () => linked ? [project] : [],
    project: { updateMany: async ({ data }: { data: object }) => { writes.push("project"); Object.assign(project, data); return { count: 1 }; } },
    product: { findMany: async () => [product], updateMany: async ({ data }: { data: object }) => { writes.push("product"); Object.assign(product, data); return { count: 1 }; } },
    changeLog: { create: async ({ data }: { data: unknown }) => { logs.push(data); return { id: "log" }; } },
  } as unknown as Parameters<typeof applyProjectionInTransaction>[0];
  return { tx, product, project, history, writes, logs };
}

test("связанный КП обновляет первоначальную и ожидаемую цену единицы, сохраняя начисленные факты", async () => {
  const f = fixture(), before = structuredClone(f.history);
  const projection = projectProposalPricing({ currency: "BYN", items: [{ id: "item", price: "100", qty: 3 }], discount: 10 }, rate);
  await applyProjectionInTransaction(f.tx, context, projection);
  assert.equal(f.product.initialPrice.toFixed(2), "100.00");
  assert.equal(f.product.expectedPrice.toFixed(2), "90.00");
  assert.equal(f.product.quantity, 3);
  assert.equal(f.product.initialPriceCaptureEligible, false);
  assert.equal(f.project.initialPrice?.toFixed(2), "300.00");
  assert.deepEqual(f.history, before);
  assert.equal(f.logs.length, 1);
  assert.equal((f.logs[0] as { action: string }).action, "proposal.pricing.sync");
});

test("чужая связь, другой этап, количество и недостаточные права отклоняются до записи цен", async () => {
  const projection = projectProposalPricing({ currency: "BYN", items: [{ id: "item", price: 100, qty: 3 }] }, rate);
  for (const [stage, linked] of [["CONTRACT", true], ["LEAD", false]] as const) {
    const f = fixture(stage, linked);
    await assert.rejects(applyProjectionInTransaction(f.tx, context, projection));
    assert.deepEqual(f.writes, []);
  }
  const f = fixture();
  await assert.rejects(applyProjectionInTransaction(f.tx, { ...context, actor: { ...context.actor, roles: ["WORKER"] } }, projection));
  f.product.quantity = 4;
  await assert.rejects(applyProjectionInTransaction(f.tx, context, projection));
  assert.deepEqual(f.writes, []);
});
