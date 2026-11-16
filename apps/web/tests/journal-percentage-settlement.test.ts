import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { settlePendingProductPercentage } from "../src/server/product-percentage-pay/core";
import { parseJournalPresentation } from "../src/server/changelog/presentation";

test("отложенное начисление сохраняет системное событие атомарно и не повторяется", async () => {
  const date = new Date("2026-11-01T10:00:00.000Z");
  const share = { id: "share", userId: "worker", userNameSnapshot: "Работник", shareUnits: 1_000_000,
    amount: null, bynAmount: null, projectAmount: null };
  let state = "PENDING_FX", auditFails = true, deliveries = 0;
  const audits: Prisma.ChangeLogCreateInput[] = [], earnings: unknown[] = [], updates: unknown[] = [];
  const current = () => ({ id: "completion", productId: "product", kind: "ASSEMBLY", state, calculationVersion: 1,
    priceSnapshot: new Prisma.Decimal(1000), ratePercentSnapshot: new Prisma.Decimal(3), productCurrency: "BYN", payrollCurrency: "BYN",
    completedAt: date, completedById: "original", amount: null, bynAmount: null, projectAmount: null,
    productRateByn: null, payrollRateByn: null, shares: [share], product: { number: "203.1", projectId: "project" } });
  const tx = {
    productPercentageCompletion: { findUnique: async () => current(),
      update: async ({ data }: { data: { state: string } }) => { state = data.state; return { ...current(), ...data }; } },
    productPercentageCompletionShare: { update: async (input: unknown) => { updates.push(input); return share; } },
    payrollEntry: { create: async ({ data }: { data: unknown }) => { earnings.push(data); return { id: "earning" }; } },
    domainEvent: { create: async () => ({ id: "event" }) },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (auditFails) throw Error("audit-failed"); audits.push(data); return data; } },
    user: { findUnique: async () => ({ id: "original", name: "Первый пользователь" }) },
  } as unknown as Prisma.TransactionClient;
  const dependencies = {
    initiator: { id: "retry", name: "Повторивший расчёт" },
    db: { productPercentageCompletion: tx.productPercentageCompletion },
    transaction: async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
      const previous = { state, auditCount: audits.length, earningsCount: earnings.length, updatesCount: updates.length };
      try { return await operation(tx); }
      catch (error) { state = previous.state; audits.length = previous.auditCount; earnings.length = previous.earningsCount; updates.length = previous.updatesCount; throw error; }
    },
    resolveRates: async () => ({ asOf: "2026-11-01", product: { currency: "BYN" as const, rate: "1.000000", date: "2026-11-01" },
      payroll: { currency: "BYN" as const, rate: "1.000000", date: "2026-11-01" } }),
    deliver: async () => { deliveries++; },
  };
  await assert.rejects(settlePendingProductPercentage("product", "ASSEMBLY", dependencies), /audit-failed/);
  assert.equal(state, "PENDING_FX"); assert.equal(earnings.length, 0); assert.equal(updates.length, 0); assert.equal(deliveries, 0);
  auditFails = false;
  assert.equal(await settlePendingProductPercentage("product", "ASSEMBLY", dependencies), "SETTLED");
  assert.equal(earnings.length, 1); assert.equal(audits.length, 1); assert.equal(deliveries, 1);
  const view = parseJournalPresentation(audits[0].presentation);
  assert.ok(view);
  assert.equal(view.actor.type, "system"); assert.equal(view.initiator?.id, "retry");
  assert.deepEqual(view.contexts.map(context => [context.kind, context.id]), [["product", "product"]]);
  assert.equal(view.changes.find(change => change.path === "amount")?.after, "30.00");
  assert.equal(await settlePendingProductPercentage("product", "ASSEMBLY", dependencies), "SETTLED");
  assert.equal(audits.length, 1); assert.equal(earnings.length, 1); assert.equal(deliveries, 1);
});
