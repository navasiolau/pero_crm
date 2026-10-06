import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import * as React from "react";
import type { Prisma } from "@prisma/client";

const customRequire = createRequire(import.meta.url);
function inject(name: string, exp: Record<string, unknown>) {
  const file = customRequire.resolve(name);
  const stub = new Module(file);
  (stub as unknown as { filename: string }).filename = file;
  (stub as unknown as { loaded: boolean }).loaded = true;
  stub.exports = exp;
  (customRequire.cache as unknown as Record<string, Module>)[file] = stub;
}
const notified: { userId: string; title: string }[] = [];
inject("../src/server/notifications/notify", { notifyPerson: async (input: { userId: string; title: string }) => { notified.push({ userId: input.userId, title: input.title }); }, notifyOrg: async () => {} });
inject("../src/auth", { auth: async () => ({ user: { id: "m", roles: ["MANAGER"] } }) });
inject("next/navigation", { redirect() { throw Error("DENIED"); }, useRouter: () => ({ refresh() {} }) });
inject("../src/components/product-inline-provider", { useOptionalProductInline: () => null });
inject("../src/lib/independent-product-percentage-action", { invokeProductPercentagePatch() { throw Error("WRITE"); } });
inject("../src/server/product-percentage-pay/actions", { retryProductPercentageAction() { throw Error("WRITE"); } });
(globalThis as unknown as { React: typeof React }).React = React;
const { previewRateFromDraft } = customRequire("../src/app/(app)/products/[id]/product-percentage-panel") as typeof import("../src/app/(app)/products/[id]/product-percentage-panel");
const { patchProductPercentageCore } = customRequire("../src/server/product-percentage-pay/patch-core") as typeof import("../src/server/product-percentage-pay/patch-core");
const { captureProductPercentageCompletion } = customRequire("../src/server/product-percentage-pay/core") as typeof import("../src/server/product-percentage-pay/core");

const actor = { id: "m", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
function state() {
  return {
    product: { id: "p", projectId: "j", status: "PRODUCTION", expectedPrice: "1000", quantity: 3, number: "202.1", engineerId: null, mounterId: null, assemblerId: "w", project: { id: "j", number: "1", currency: "BYN" } },
    config: { id: "cfg", ratePercent: "6", revision: 4 },
    completion: { id: "c", state: "SETTLED", amount: "180.00", ratePercentSnapshot: "6", shares: [{ id: "s", userId: "w", userNameSnapshot: "Сборщик", shareUnits: 1000000, amount: "180.00" }] } as unknown as Record<string, unknown> & { shares: Record<string, unknown>[] },
    entry: { id: "e", amount: "180.00" } as Record<string, unknown> | null,
    entries: [] as Record<string, unknown>[],
    logs: [] as Record<string, unknown>[],
    notified: [] as { userId: string; title: string }[],
  };
}
function txOf(s: ReturnType<typeof state>) {
  const tx = {
    product: { findUnique: async () => ({ ...s.product }) },
    productPercentageConfig: {
      findUnique: async () => ({ ...s.config }),
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(s.config, data.ratePercent !== undefined ? { ratePercent: String(data.ratePercent) } : {}, typeof data.revision === "object" ? { revision: s.config.revision + 1 } : {}); return { ...s.config }; },
    },
    productPercentageCompletion: {
      findUnique: async () => (s.completion ? { ...s.completion, shares: s.completion.shares.map((r) => ({ ...r })) } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(s.completion, data); return s.completion; },
    },
    productPercentageCompletionShare: {
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(s.completion.shares[0], data); return s.completion.shares[0]; },
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `sh${s.completion.shares.length}`, ...data }; s.completion.shares.push(row); return row; },
    },
    domainEvent: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: `ev${s.logs.length}`, ...data }) },
    payrollEntry: {
      findUnique: async () => s.entry,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `pe${s.entries.length}`, ...data }; s.entries.push(row); return row; },
    },
    changeLog: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { s.logs.push(data); return data; },
    },
    user: { findUnique: async () => ({ active: true, roles: ["WORKER"] }) },
  } as unknown as Prisma.TransactionClient;
  return tx;
}
function patchInput(value: string, expected: string | null, rev = 4) {
  return { productId: "p", kind: "ASSEMBLY", field: "ratePercent", value, expectedValue: expected, expectedRevision: rev, clientMutationId: randomUUID() } as never;
}

test("правка ставки после начисления пересчитывает снимок и пишет дельту с уведомлением", async () => {
  const s = state();
  notified.length = 0;
  const result = await patchProductPercentageCore(actor, patchInput("5", "6"), txOf(s));
  assert.equal(result.ok, true);
  assert.equal(s.completion.amount, "150.00");
  assert.equal(s.completion.shares[0].amount, "150.00");
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].amount, "-30.00");
  assert.equal((s.entries[0].month as string).length, 7);
  assert.ok(String(s.entries[0].comment).includes("было 180.00"));
  assert.equal(notified.length, 1);
  assert.equal(notified[0].userId, "w");
  assert.ok(s.logs.some((row) => (row as { action: string }).action === "percentage.rateAdjust"));
});

test("правка при DONE отклоняется", async () => {
  const s = state();
  s.product.status = "DONE";
  const result = await patchProductPercentageCore(actor, patchInput("5", "6"), txOf(s));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /завершено/);
  assert.equal(s.entries.length, 0);
});

test("пропущенное начисление добирается поздним переходом", async () => {
  const s = state();
  s.completion = { id: "c", state: "SKIPPED_ONCE", amount: null, ratePercentSnapshot: null, shares: [{ id: "s0", userId: "w", userNameSnapshot: "Сборщик", shareUnits: 1000000, amount: null }] } as unknown as typeof s.completion;
  s.config.ratePercent = "4";
  const tx = {
    ...txOf(s),
    product: {
      findUnique: async () => ({ ...s.product, percentageConfigs: [{ ratePercent: s.config.ratePercent }], stagePayPools: [], assembler: { id: "w", name: "Сборщик", active: true, roles: ["WORKER"] }, engineer: null, mounter: null }),
    },
    productStatusHistory: { findFirst: async () => null },
  } as unknown as Prisma.TransactionClient;
  const effects = { eventIds: [] as string[], earnings: [] as { userId: string; userName: string; amount: string; currency: string }[] };
  const result = await captureProductPercentageCompletion(tx, actor, "p", "ASSEMBLY", "STORAGE", effects, "PRODUCTION");
  assert.equal(result, "SETTLED");
  assert.equal(s.completion.state, "SETTLED");
  assert.equal(s.completion.shares.length, 1);
  assert.equal(s.completion.shares[0].amount, "120.00");
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].amount, "120.00");
  assert.equal(effects.earnings.length, 1);
});

test("превью-ставка берётся из черновика, иначе из сохранённой", () => {
  assert.equal(previewRateFromDraft("6", "5"), "6.00");
  assert.equal(previewRateFromDraft("1.25", "5"), "1.25");
  assert.equal(previewRateFromDraft("", "5"), "5");
  assert.equal(previewRateFromDraft(".", "5"), "5");
  assert.equal(previewRateFromDraft("", null), null);
});
