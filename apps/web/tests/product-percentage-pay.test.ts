import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { allocatePercentageShares, calculateProductCurrencyPercentage, parsePercentageRate, transferOwnPercentageShare } from "../src/lib/product-percentage-pay";
import { decideProductPercentageStatus } from "../src/lib/product-percentage-status";
import { assertPercentagePayrollCurrencyChange, captureProductPercentageCompletion, configureProductPercentageCore, settlePendingProductPercentage, transferProductPercentageCore } from "../src/server/product-percentage-pay/core";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { closeEngineeringStageAction, configureEngineeringPoolAction } from "../src/server/product-stage-pay/actions";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";
import { splitTaskCore } from "../src/server/tasks/share-core";
import { canSplitTask } from "../src/server/tasks/share-policy";
import { taskShareFixture } from "./helpers/task-share-fixture";

test("нулевая ставка допустима, null не является нулём", () => {
  assert.equal(parsePercentageRate("0"), "0.00");
  assert.equal(parsePercentageRate(null), null);
  assert.throws(() => parsePercentageRate("100.01"));
  assert.throws(() => parsePercentageRate("1.001"));
});

test("прямые доли распределяют сумму один раз и сохраняют копейки", () => {
  const shares = allocatePercentageShares("10.01", [
    { userId: "a", shareUnits: 500000 },
    { userId: "b", shareUnits: 500000 },
  ]);
  assert.deepEqual(shares, [
    { userId: "a", shareUnits: 500000, amount: "5.01" },
    { userId: "b", shareUnits: 500000, amount: "5.00" },
  ]);
  assert.throws(() => allocatePercentageShares("10.00", [{ userId: "a", shareUnits: 999999 }]));
});

test("участник передаёт часть только своей доли", () => {
  assert.deepEqual(transferOwnPercentageShare([
    { userId: "a", shareUnits: 750000 },
    { userId: "b", shareUnits: 250000 },
  ], "a", "c", "50"), [
    { userId: "a", shareUnits: 375000 },
    { userId: "b", shareUnits: 250000 },
    { userId: "c", shareUnits: 375000 },
  ]);
  assert.throws(() => transferOwnPercentageShare([{ userId: "a", shareUnits: 1000000 }], "b", "c", "10"));
  assert.throws(() => transferOwnPercentageShare([
    { userId: "a", shareUnits: 1 }, { userId: "b", shareUnits: 999999 },
  ], "a", "c", "50"));
  assert.deepEqual(transferOwnPercentageShare([
    { userId: "a", shareUnits: 700000 }, { userId: "b", shareUnits: 300000 },
  ], "a", "b", "10"), [
    { userId: "a", shareUnits: 630000 }, { userId: "b", shareUnits: 370000 },
  ]);
});

test("предпросмотр в валюте изделия не требует выдуманного FX", () => {
  assert.equal(calculateProductCurrencyPercentage("1000", "50"), "500.00");
  assert.equal(calculateProductCurrencyPercentage("0", "100"), "0.00");
  assert.equal(calculateProductCurrencyPercentage("1.01", "50"), "0.51");
});

test("менеджер свободен; инженер имеет только ручной DESIGN→PRODUCTION с моделью", () => {
  const context = { from: "DESIGN" as const, to: "PRODUCTION" as const, assignedEngineer: true, participant: false, hasB3d: false, noModel: false };
  assert.equal(decideProductPercentageStatus(["MANAGER", "ENGINEER"], context).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], context).allowed, false);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, hasB3d: true }).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, noModel: true }).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, to: "DONE" }).allowed, false);
  assert.equal(decideProductPercentageStatus(["WORKER", "MOUNTER"], { ...context, hasB3d: true }).allowed, false);
});

test("первый переход сохраняет нулевую цену и ставку как pending, а повтор не дублирует снимок", async () => {
  const saved: unknown[] = [];
  const tx = {
    productPercentageCompletion: {
      findUnique: async () => saved.length ? { state: "PENDING_FX" } : null,
      create: async ({ data }: { data: unknown }) => { saved.push(data); return { id: "completion" }; },
    },
    product: { findUnique: async () => ({ expectedPrice: { toString: () => "0.00" },
      project: { currency: "BYN" }, percentageConfigs: [{ ratePercent: { toString: () => "0.00" }, revision: 3,
        participants: [{ userId: "engineer", shareUnits: 1000000,
          user: { id: "engineer", name: "Инженер", active: true, roles: ["ENGINEER"] } }] }], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "ENGINEERING", "PRODUCTION"), "PENDING_FX");
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "ENGINEERING", "DONE"), "PENDING_FX");
  assert.equal(saved.length, 1);
  const snapshot = saved[0] as { priceSnapshot: unknown; ratePercentSnapshot: unknown; shares: { create: unknown[] } };
  assert.ok(snapshot.priceSnapshot);
  assert.ok(snapshot.ratePercentSnapshot);
  assert.equal(snapshot.shares.create.length, 1);
});

test("null конфигурация фиксирует однократный пропуск без начисления", async () => {
  let state = "";
  const tx = {
    productPercentageCompletion: { findUnique: async () => null,
      create: async ({ data }: { data: { state: string } }) => { state = data.state; return { id: "completion" }; } },
    product: { findUnique: async () => ({ expectedPrice: null, project: { currency: "BYN" },
      percentageConfigs: [], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "ENGINEERING", "PRODUCTION"), "SKIPPED_ONCE");
  assert.equal(state, "SKIPPED_ONCE");
});

test("новая обычная сдельная работа после настройки не отменяет монтажный процент", async () => {
  let savedState = "";
  const tx = {
    productPercentageCompletion: { findUnique: async () => null,
      create: async ({ data }: { data: { state: string } }) => { savedState = data.state; return { id: "completion" }; } },
    product: { findUnique: async () => ({ expectedPrice: { toString: () => "500" }, project: { currency: "BYN" },
      works: [{ id: "new-ordinary", paymentKind: "LEGACY" }],
      percentageConfigs: [{ ratePercent: { toString: () => "10" }, revision: 2, reviewedLegacyWorkIds: [],
        participants: [{ userId: "mounter", shareUnits: 1000000,
          user: { id: "mounter", name: "Монтажник", active: true, roles: ["MOUNTER"] } }] }], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "INSTALLATION", "DONE"), "PENDING_FX");
  assert.equal(savedState, "PENDING_FX");
});

test("миграция сохраняет прежние финансовые таблицы и защищает пройденные этапы", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20260930150000_product_percentage_pay/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN\s+"percentageCompletionShareId" TEXT/);
  assert.match(sql, /ADD COLUMN\s+"noModel" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /'LEGACY_PROTECTED'/);
  assert.match(sql, /ProductStatusHistory/);
  assert.match(sql, /PERCENT_PROJECT/);
  assert.match(sql, /protect_product_percentage_completion/);
  assert.match(sql, /protect_product_percentage_share/);
  assert.match(sql, /percentageCompletionShareId" IS NOT NULL/);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\s+"?(?:PayrollEntry|Payout|Work|Task)"?/i);
});

test("старые инженерные endpoints отказывают до записи, project writer не начисляет", async () => {
  assert.equal((await closeEngineeringStageAction({ productId: "p", expectedPoolRevision: 0, requestId: "old" })).ok, false);
  assert.equal((await configureEngineeringPoolAction({ productId: "p", ratePercent: "10", workWeights: [], expectedPoolRevision: 0 })).ok, false);
  const core = readFileSync(new URL("../src/server/projects/stage-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(core, /payrollEntry\.create|productStagePayPool\.create/);
});

function settlementHarness(price: string, rate: string) {
  const completedAt = new Date("2026-09-30T10:00:00.000Z");
  const completion = { id: "completion", productId: "p", kind: "ENGINEERING", state: "PENDING_FX",
    completedAt, completedById: "manager", priceSnapshot: { toString: () => price },
    ratePercentSnapshot: { toString: () => rate }, productCurrency: "BYN", payrollCurrency: "BYN",
    shares: [{ id: "share-a", userId: "a", userNameSnapshot: "А", shareUnits: 500000 },
      { id: "share-b", userId: "b", userNameSnapshot: "Б", shareUnits: 500000 }],
    product: { number: "1.1", projectId: "project" } };
  const entries: unknown[] = [];
  const events: { data: { payload: { amount: unknown } } }[] = [];
  const deliveries: unknown[] = [];
  const shareUpdates: unknown[] = [];
  const db = { productPercentageCompletion: { findUnique: async () => completion } } as unknown as Pick<PrismaClient, "productPercentageCompletion">;
  const transaction = (async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => operation({
    productPercentageCompletion: { findUnique: async () => completion,
      update: async ({ data }: { data: { state: string } }) => { completion.state = data.state; return completion; } },
    productPercentageCompletionShare: { update: async (input: unknown) => { shareUpdates.push(input); return {}; } },
    payrollEntry: { create: async ({ data }: { data: unknown }) => { entries.push(data); return {}; } },
    domainEvent: { create: async (input: { data: { payload: { amount: unknown } } }) => {
      events.push(input); return { id: `event-${events.length}` }; } },
  } as unknown as Prisma.TransactionClient)) as TaskTransaction;
  const rates = { asOf: "2026-09-30", product: { currency: "BYN" as const, rate: "1.000000", date: "2026-09-30" },
    payroll: { currency: "BYN" as const, rate: "1.000000", date: "2026-09-30" } };
  const deliver = async (...args: unknown[]) => { deliveries.push(args); };
  return { completion, completedAt, entries, events, deliveries, shareUpdates,
    deps: { db, transaction, resolveRates: async () => rates, deliver } };
}

test("положительное начисление создаётся по frozen input ровно один раз", async () => {
  const h = settlementHarness("500", "10");
  assert.equal(await settlePendingProductPercentage("p", "ENGINEERING", h.deps), "SETTLED");
  assert.equal(h.entries.length, 2);
  assert.equal(h.events.length, 2);
  assert.equal(typeof h.events[0].data.payload.amount, "number");
  assert.equal(h.deliveries.length, 1);
  assert.equal(await settlePendingProductPercentage("p", "ENGINEERING", h.deps), "SETTLED");
  assert.equal(h.entries.length, 2);
  assert.equal(h.deliveries.length, 1);
});

test("нулевой фонд завершает этап без PayrollEntry и ложного события", async () => {
  const h = settlementHarness("0", "10");
  assert.equal(await settlePendingProductPercentage("p", "ENGINEERING", h.deps), "SETTLED");
  assert.equal(h.shareUpdates.length, 2);
  assert.equal(h.entries.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal(h.deliveries.length, 0);
});

test("FX failure сохраняет pending и retry читает замороженную дату", async () => {
  const h = settlementHarness("500", "10");
  await assert.rejects(settlePendingProductPercentage("p", "ENGINEERING", {
    ...h.deps, resolveRates: async (_productCurrency, _payrollCurrency, completedAt) => {
      assert.equal(completedAt.toISOString(), h.completedAt.toISOString());
      throw new Error("FX unavailable");
    },
  }), /FX unavailable/);
  assert.equal(h.completion.state, "PENDING_FX");
  assert.equal(h.entries.length, 0);
  assert.equal(await settlePendingProductPercentage("p", "ENGINEERING", h.deps), "SETTLED");
  assert.equal(h.entries.length, 2);
});

test("смена валюты зарплаты блокируется pending/settled, skipped не фиксирует деньги", async () => {
  for (const state of ["PENDING_FX", "SETTLED"] as const) {
    const tx = { productPercentageCompletion: { count: async ({ where }: { where: { state: { in: string[] }; payrollCurrency: { not: string } } }) => {
      assert.equal(where.payrollCurrency.not, "USD"); return Number(where.state.in.includes(state));
    } } } as unknown as Pick<Prisma.TransactionClient, "productPercentageCompletion">;
    await assert.rejects(assertPercentagePayrollCurrencyChange(tx, "USD"), /зафиксирована/);
  }
  const skipped = { productPercentageCompletion: { count: async () => 0 } } as unknown as Pick<Prisma.TransactionClient, "productPercentageCompletion">;
  await assert.doesNotReject(assertPercentagePayrollCurrencyChange(skipped, "USD"));
});

test("менеджер явно отмечает только неоплаченную монтажную работу вместе с прямыми долями", async () => {
  const writes: string[] = [];
  let paid = true;
  const tx = {
    user: { findMany: async () => [{ id: "mounter" }] },
    product: { findUnique: async () => ({ id: "product", projectId: "project" }) },
    productPercentageCompletion: { findUnique: async () => null },
    productPercentageConfig: { findUnique: async () => null,
      create: async () => { writes.push("config"); return { id: "config", revision: 1 }; } },
    productPercentageParticipant: { createMany: async () => { writes.push("participant"); } },
    work: { findMany: async () => [{ id: "work", productId: "product", projectId: "project", paymentKind: "LEGACY",
      stagePayPoolId: null, poolWeightUnits: null, tasks: [{ id: "task", projectId: "project", productId: "product" }] }],
      updateMany: async () => { writes.push("classification"); } },
    payrollEntry: { findFirst: async () => paid ? { id: "paid" } : null },
    changeLog: { create: async () => { writes.push("audit"); } },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  const input = { productId: "product", kind: "INSTALLATION" as const, ratePercent: "5", expectedRevision: 0,
    participants: [{ userId: "mounter", shareUnits: 1000000 }], installationWorkIds: ["work"], reviewedLegacyWorks: true };
  await assert.rejects(configureProductPercentageCore(actor, { ...input, reviewedLegacyWorks: false }, tx), /Подтвердите просмотр/);
  assert.deepEqual(writes, []);
  await assert.rejects(configureProductPercentageCore(actor, input, tx), /уже есть начисление/);
  assert.deepEqual(writes, []);
  paid = false;
  assert.deepEqual(await configureProductPercentageCore(actor, input, tx), { revision: 1 });
  assert.deepEqual(writes, ["classification", "config", "participant", "audit"]);
});

test("участник передаёт долю существующему коллеге без изменения общей ставки", async () => {
  let saved: { userId: string; shareUnits: number }[] = [];
  const config = { id: "cfg", revision: 2, ratePercent: "5.00", participants: [
    { userId: "a", shareUnits: 700000 }, { userId: "b", shareUnits: 300000 },
  ] };
  const tx = {
    product: { findUnique: async () => ({ engineerId: "a" }) },
    productPercentageCompletion: { findUnique: async () => null },
    productPercentageConfig: { findUnique: async () => config,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        assert.deepEqual(Object.keys(data), ["revision"]); return { revision: 3 }; } },
    productPercentageParticipant: { deleteMany: async () => ({}),
      createMany: async ({ data }: { data: { userId: string; shareUnits: number }[] }) => { saved = data; } },
    user: { findFirst: async () => ({ id: "b" }) },
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "a", name: "А", roles: ["ENGINEER" as const], source: "web" as const };
  assert.deepEqual(await transferProductPercentageCore(actor, { productId: "p", kind: "ENGINEERING",
    toUserId: "b", percentOfOwnShare: "10", expectedRevision: 2 }, tx), { revision: 3 });
  assert.deepEqual(saved.map((row) => [row.userId, row.shareUnits]), [["a", 630000], ["b", 370000]]);
  await assert.rejects(transferProductPercentageCore({ ...actor, roles: ["WORKER"] }, { productId: "p", kind: "ENGINEERING",
    toUserId: "b", percentOfOwnShare: "10", expectedRevision: 2 }, tx), /своего этапа/);
});

test("единый статусный handler сохраняет manager DONE с двумя terminal snapshots и проверяет B3D инженеру", async () => {
  const product = { id: "p", projectId: "project", number: "1.1", title: "Изделие", status: "DESIGN",
    engineerId: "engineer", noModel: false, expectedPrice: null, files: [] as { id: string }[],
    percentageConfigs: [], stagePayPools: [], project: { currency: "BYN" } };
  const completions: { kind: string; state: string }[] = [];
  const writes: string[] = [];
  const tx = {
    product: { findUnique: async () => product, update: async ({ data }: { data: { status: string } }) => {
      writes.push("status"); product.status = data.status; return product; } },
    task: { findFirst: async () => null },
    productPercentageCompletion: { findUnique: async ({ where }: { where: { productId_kind: { kind: string } } }) =>
      completions.find((row) => row.kind === where.productId_kind.kind) ?? null,
      create: async ({ data }: { data: { kind: string; state: string } }) => { completions.push(data); return { id: data.kind }; } },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    productStatusHistory: { create: async () => { writes.push("history"); return {}; } },
    changeLog: { create: async () => { writes.push("audit"); return {}; } },
    domainEvent: { create: async () => { writes.push("event"); return { id: "event" }; } },
  } as unknown as Prisma.TransactionClient;
  const engineer = { id: "engineer", name: "Инженер", roles: ["ENGINEER" as const], source: "web" as const };
  const denied = await changeProductStatusTransaction(tx, engineer, "p", "PRODUCTION");
  assert.equal(denied.ok, false); assert.deepEqual(writes, []);
  const manager = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  const moved = await changeProductStatusTransaction(tx, manager, "p", "DONE");
  assert.equal(moved.ok, true); assert.equal(product.status, "DONE");
  assert.deepEqual(completions.map((row) => [row.kind, row.state]),
    [["ENGINEERING", "SKIPPED_ONCE"], ["INSTALLATION", "SKIPPED_ONCE"]]);
  assert.deepEqual(writes, ["status", "audit", "audit", "history", "audit", "event"]);
  assert.equal((await changeProductStatusTransaction(tx, manager, "p", "DONE")).ok, true);
  assert.equal(completions.length, 2);
});

test("после SKIPPED_ONCE менеджер настраивает ставку, но цикл статусов не начисляет задним числом", async () => {
  const completion = { id: "skipped", productId: "p", kind: "ENGINEERING", state: "SKIPPED_ONCE",
    priceSnapshot: null, ratePercentSnapshot: null };
  const original = structuredClone(completion);
  const product = { id: "p", projectId: "project", number: "1.1", title: "Изделие", status: "DESIGN",
    engineerId: "engineer", noModel: false, expectedPrice: "500", files: [], percentageConfigs: [],
    stagePayPools: [], project: { currency: "BYN" } };
  let configCreated = 0, snapshotsCreated = 0, payrollCreated = 0;
  const tx = {
    user: { findMany: async () => [{ id: "engineer" }] },
    product: { findUnique: async () => product, update: async ({ data }: { data: { status: string } }) => {
      product.status = data.status; return product; } },
    productPercentageCompletion: { findUnique: async () => completion,
      create: async () => { snapshotsCreated++; return completion; } },
    productPercentageConfig: { findUnique: async () => null,
      create: async () => { configCreated++; return { id: "cfg", revision: 1 }; } },
    productPercentageParticipant: { createMany: async () => ({}) },
    task: { findFirst: async () => null },
    productStatusHistory: { create: async () => ({}) },
    payrollEntry: { create: async () => { payrollCreated++; return {}; } },
    changeLog: { create: async () => ({}) },
    domainEvent: { create: async () => ({ id: "event" }) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.deepEqual(await configureProductPercentageCore(actor, { productId: "p", kind: "ENGINEERING",
    ratePercent: "10", participants: [{ userId: "engineer", shareUnits: 1000000 }], expectedRevision: 0 }, tx), { revision: 1 });
  for (const status of ["PRODUCTION", "DESIGN", "PRODUCTION"] as const) {
    const result = await changeProductStatusTransaction(tx, actor, "p", status);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.captured, []);
  }
  assert.equal(configCreated, 1); assert.equal(snapshotsCreated, 0); assert.equal(payrollCreated, 0);
  assert.deepEqual(completion, original);
  for (const state of ["PENDING_FX", "SETTLED", "LEGACY_PROTECTED"] as const) {
    completion.state = state;
    await assert.rejects(configureProductPercentageCore(actor, { productId: "p", kind: "ENGINEERING",
      ratePercent: "10", participants: [{ userId: "engineer", shareUnits: 1000000 }], expectedRevision: 0 }, tx), /снимок нельзя изменить/);
  }
});

test("SKIPPED editor показывает позднюю конфигурацию отдельно от frozen history", async () => {
  const database = {
    task: { findMany: async () => [] },
    productPercentageParticipant: { findMany: async () => [] },
    product: { findFirst: async () => ({ id: "p", noModel: false, engineerId: "old", engineer: { name: "Старый" },
      expectedPrice: { toString: () => "500" }, project: { currency: "USD" }, files: [], works: [], stagePayPools: [],
      percentageConfigs: [{ kind: "ENGINEERING", revision: 1, ratePercent: { toString: () => "10" },
        participants: [{ userId: "new", shareUnits: 1000000, user: { name: "Новый" } }] }],
      percentageCompletions: [{ kind: "ENGINEERING", state: "SKIPPED_ONCE", completedAt: new Date("2026-09-29T10:00:00Z"),
        reason: "Не задана ставка", priceSnapshot: { toString: () => "100" }, ratePercentSnapshot: { toString: () => "5" },
        productCurrency: "BYN", payrollCurrency: "BYN", amount: null,
        shares: [{ userId: "old", userNameSnapshot: "Старый", shareUnits: 1000000, amount: null }] }] }) },
    user: { findMany: async () => [{ id: "new", name: "Новый" }] },
    payrollEntry: { findMany: async () => [] },
  } as unknown as Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">;
  const view = await getProductPercentageView({ id: "manager", roles: ["MANAGER"] }, "p", database);
  const section = view.sections.ENGINEERING;
  assert.equal(section.state, "SKIPPED_ONCE"); assert.equal(section.canManage, true); assert.equal(section.canTransfer, false);
  assert.equal(section.ratePercent, "10"); assert.equal(section.price, "500");
  assert.equal(section.productCurrency, "USD"); assert.equal(section.payrollCurrency, null); assert.equal(section.total, "50.00");
  assert.deepEqual(section.members.map((member) => [member.userId, member.shareUnits, member.amount]), [["new", 1000000, "50.00"]]);
  assert.equal(section.skippedSnapshot?.price, "100"); assert.equal(section.skippedSnapshot?.ratePercent, "5");
  assert.equal(section.skippedSnapshot?.productCurrency, "BYN");
  assert.deepEqual(section.skippedSnapshot?.members.map((member) => member.userId), ["old"]);
});

test("старый ENGINEERING Work не даёт новый split/доли, прежний UUID receipt только replay", async () => {
  const f = taskShareFixture("DESIGN");
  Object.assign(f.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1000000,
    priceSnapshot: null, total: null });
  f.state().tasks[0].stageShareUnits = 1000000;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  const requestId = "11111111-1111-4111-8111-111111111111";
  const input = { taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, requestId };
  const before = structuredClone(f.state());
  assert.equal(canSplitTask(actor, { assigneeId: "worker", status: "IN_PROGRESS", product: { engineerId: "engineer", status: "DESIGN" },
    paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
  assert.equal((await splitTaskCore(actor, input, f.transaction)).ok, false);
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.writes, []);
  f.state().logs.push({ id: `task-split:${requestId}`, actorId: actor.id, entityId: input.taskId, action: "split",
    newValue: { recipientId: input.recipientId, percent: "30.00", expectedRevision: input.expectedRevision,
      childTaskId: "historic-child", groupId: "historic-group" } });
  const repeated = await splitTaskCore(actor, input, f.transaction);
  assert.equal(repeated.ok, true);
  if (repeated.ok) assert.equal(repeated.repeated, true);
  assert.deepEqual(f.writes, []);
});
