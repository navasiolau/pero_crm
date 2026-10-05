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
import { patchProductPercentageCore } from "../src/server/product-percentage-pay/patch-core";
import { randomUUID } from "node:crypto";
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

test("менеджер свободен; текущий инженер DESIGN↔PRODUCTION без модели", () => {
  const context = { from: "DESIGN" as const, to: "PRODUCTION" as const, assignedEngineer: true, participant: false, hasB3d: false, noModel: false };
  assert.equal(decideProductPercentageStatus(["MANAGER", "ENGINEER"], context).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], context).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, hasB3d: true }).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, noModel: true }).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, to: "DONE" }).allowed, false);
  assert.equal(decideProductPercentageStatus(["WORKER", "MOUNTER"], { ...context, hasB3d: true }).allowed, false);
});

test("v3 первый переход фиксирует нулевой BYN расчёт без начисления, повтор не дублирует снимок", async () => {
  const saved: unknown[] = [];
  const shares: unknown[] = [];
  const tx = {
    productStatusHistory: { findFirst: async () => null },
    productPercentageCompletion: {
      findUnique: async () => saved.length ? { state: "SETTLED" } : null,
      create: async ({ data }: { data: unknown }) => { saved.push(data); return { id: "completion" }; },
    },
    product: { findUnique: async () => ({ quantity: 3, engineer: { id: "engineer", name: "Инженер", active: true, roles: ["ENGINEER"] }, expectedPrice: { toString: () => "0.00" },
      project: { currency: "BYN" }, percentageConfigs: [{ ratePercent: { toString: () => "0.00" }, revision: 3,
        participants: [{ userId: "engineer", shareUnits: 1000000,
          user: { id: "engineer", name: "Инженер", active: true, roles: ["ENGINEER"] } }] }], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    productPercentageCompletionShare: { create: async ({data}: {data: unknown}) => {shares.push(data); return {id: "share"};} },
    payrollEntry: { create: async () => { throw Error("Zero amount must not create payroll"); } },
    domainEvent: { create: async () => { throw Error("Zero amount must not create event"); } },
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "ENGINEERING", "PRODUCTION"), "SETTLED");
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "ENGINEERING", "DONE"), "SETTLED");
  assert.equal(saved.length, 1);
  const snapshot = saved[0] as { priceSnapshot: unknown; ratePercentSnapshot: unknown; calculationVersion: number; quantitySnapshot: number; amount: string };
  assert.ok(snapshot.priceSnapshot);
  assert.ok(snapshot.ratePercentSnapshot);
  assert.equal(snapshot.calculationVersion, 4); assert.equal(snapshot.quantitySnapshot, 3);
  assert.equal(snapshot.amount, "0.00"); assert.equal(shares.length, 1);
});

test("null конфигурация фиксирует однократный пропуск без начисления", async () => {
  let state = "";
  const tx = {
    productStatusHistory: { findFirst: async () => null },
    productPercentageCompletion: { findUnique: async () => null,
      create: async ({ data }: { data: { state: string } }) => { state = data.state; return { id: "completion" }; } },
    product: { findUnique: async () => ({ quantity: 3, expectedPrice: null, project: { currency: "BYN" },
      percentageConfigs: [], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "ENGINEERING", "PRODUCTION"), "SKIPPED_ONCE");
  assert.equal(state, "SKIPPED_ONCE");
});

test("v3 самостоятельная обычная работа сохраняет монтажный процент от цены всей партии", async () => {
  let savedState = "";
  const payroll: {amount: string}[] = [];
  const tx = {
    productStatusHistory: { findFirst: async () => null },
    productPercentageCompletion: { findUnique: async () => null,
      create: async ({ data }: { data: { state: string } }) => { savedState = data.state; return { id: "completion" }; } },
    product: { findUnique: async () => ({ id: "p", projectId: "project", quantity: 3, mounter: {id: "mounter", name: "Монтажник", active: true, roles: ["MOUNTER"]}, expectedPrice: { toString: () => "500" }, project: { currency: "BYN" },
      works: [{ id: "new-ordinary", paymentKind: "LEGACY" }],
      percentageConfigs: [{ ratePercent: { toString: () => "10" }, revision: 2, workReview: [{workId: "new-ordinary", classification: "INDEPENDENT"}],
        participants: [{ userId: "mounter", shareUnits: 1000000,
          user: { id: "mounter", name: "Монтажник", active: true, roles: ["MOUNTER"] } }] }], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    work: {findMany: async () => [{id: "new-ordinary", title: "Обычная работа", tasks: []}]},
    productPercentageCompletionShare: {create: async () => ({id: "share"})},
    payrollEntry: {findMany: async () => [], create: async ({data}: {data: {amount: string}}) => {payroll.push(data); return {};}},
    domainEvent: {create: async () => ({id: "event"})},
    changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "INSTALLATION", "DONE"), "SETTLED");
  assert.equal(savedState, "SETTLED"); assert.equal(payroll.length, 1); assert.equal(payroll[0].amount, "150.00");
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
  const completion = { id: "completion", calculationVersion: 1, productId: "p", kind: "ENGINEERING", state: "PENDING_FX",
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

test("retired configure не классифицирует и не создаёт доли; новый patch назначает одного монтажника", async () => {
  const writes: string[] = [];
  const product = {id: "product", projectId: "project", engineerId: null, mounterId: null as string|null};
  const tx = {
    product: {findUnique: async () => product, update: async ({data}: {data: {mounterId: string|null}}) => {writes.push("assignee"); Object.assign(product,data); return product;}},
    user: {findUnique: async () => ({active: true, roles: ["MOUNTER"]})},
    productPercentageConfig: {findUnique: async () => null, create: async () => {writes.push("config"); return {id: "cfg",revision:1};}},
    changeLog: {findUnique: async () => null, create: async () => {writes.push("audit"); return {}; }},
    work: {updateMany: async () => {throw Error("No classification writer");}},
    productPercentageParticipant: {createMany: async () => {throw Error("No participant writer");}},
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  const old = {productId:"product",kind:"INSTALLATION" as const,ratePercent:"5",expectedRevision:0,participants:[{userId:"mounter",shareUnits:1000000}],installationWorkIds:["work"]};
  for(const reviewedLegacyWorks of [false,true]) {
    await assert.rejects(configureProductPercentageCore(actor,{...old,reviewedLegacyWorks},tx),/одиночное поле/);
    assert.deepEqual(writes,[]);
  }
  const result=await patchProductPercentageCore(actor,{productId:"product",kind:"INSTALLATION",field:"assigneeId",value:"mounter",expectedValue:null,expectedRevision:0,clientMutationId:randomUUID()},tx);
  assert.equal(result.ok,true); if(result.ok) assert.equal(result.revision,1);
  assert.equal(product.mounterId,"mounter"); assert.deepEqual(writes,["assignee","config","audit"]);
});

test("historical DONE skips absent completion without reading work payments or creating marker", async () => {
  const tx = {
    productPercentageCompletion: {findUnique: async () => null, create: async () => {throw Error("no historical marker")}},
    product: {findUnique: async () => ({status:"DONE"})},
    payrollEntry: {findMany: async () => {throw Error("no work pay read")},create: async () => {throw Error("no historic accrual")}},
  } as unknown as Prisma.TransactionClient;
  const actor = {id:"manager",name:"Manager",roles:["MANAGER" as const],source:"web" as const};
  assert.equal(await captureProductPercentageCompletion(tx,actor,"p","INSTALLATION","DONE"),"LEGACY_PROTECTED");
});

test("retired transfer отказывает до любых операций для владельца доли и посторонней роли", async () => {
  const tx = new Proxy({}, {get() {throw Error("Retired transfer must not read or write");}}) as Prisma.TransactionClient;
  const actor = {id:"a",name:"А",roles:["ENGINEER" as const],source:"web" as const};
  const input={productId:"p",kind:"ENGINEERING" as const,toUserId:"b",percentOfOwnShare:"10",expectedRevision:2};
  await assert.rejects(transferProductPercentageCore(actor,input,tx),/больше недоступна/);
  await assert.rejects(transferProductPercentageCore({...actor,roles:["WORKER"]},input,tx),/больше недоступна/);
});

test("единый статусный handler сохраняет manager DONE и не требует B3D назначенному инженеру", async () => {
  const product = { id: "p", projectId: "project", number: "1.1", title: "Изделие", status: "DESIGN",
    quantity: 3, engineerId: "engineer", noModel: false, expectedPrice: null, files: [] as { id: string }[],
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
    productStatusHistory: { findFirst: async () => null, create: async () => { writes.push("history"); return {}; } },
    changeLog: { create: async () => { writes.push("audit"); return {}; } },
    domainEvent: { create: async () => { writes.push("event"); return { id: "event" }; } },
  } as unknown as Prisma.TransactionClient;
  const engineer = { id: "engineer", name: "Инженер", roles: ["ENGINEER" as const], source: "web" as const };
  const denied = await changeProductStatusTransaction(tx, {...engineer,id:"foreign"}, "p", "PRODUCTION");
  assert.equal(denied.ok, false); assert.deepEqual(writes, []);
  const manager = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  const moved = await changeProductStatusTransaction(tx, manager, "p", "DONE");
  assert.equal(moved.ok, true); assert.equal(product.status, "DONE");
  assert.deepEqual(completions.map((row) => [row.kind, row.state]),
    [["ENGINEERING", "SKIPPED_ONCE"], ["ASSEMBLY", "SKIPPED_ONCE"], ["INSTALLATION", "SKIPPED_ONCE"]]);
  assert.deepEqual(writes, ["status", "audit", "audit", "audit", "history", "audit", "event"]);
  assert.equal((await changeProductStatusTransaction(tx, manager, "p", "DONE")).ok, true);
  assert.equal(completions.length, 3);
});

test("после SKIPPED_ONCE менеджер настраивает ставку, но цикл статусов не начисляет задним числом", async () => {
  const completion = { id: "skipped", productId: "p", kind: "ENGINEERING", state: "SKIPPED_ONCE",
    priceSnapshot: null, ratePercentSnapshot: null };
  const original = structuredClone(completion);
  const product = { id: "p", projectId: "project", number: "1.1", title: "Изделие", status: "DESIGN",
    quantity: 3, engineerId: "engineer", noModel: false, expectedPrice: "500", files: [], percentageConfigs: [],
    stagePayPools: [], project: { currency: "BYN" } };
  let configCreated = 0, snapshotsCreated = 0, payrollCreated = 0;
  let config: {id: string; revision: number; ratePercent: string} | null = null;
  const tx = {
    user: { findMany: async () => [{ id: "engineer" }] },
    product: { findUnique: async () => product, update: async ({ data }: { data: { status: string } }) => {
      product.status = data.status; return product; } },
    productPercentageCompletion: { findUnique: async () => completion,
      create: async () => { snapshotsCreated++; return completion; } },
    productPercentageConfig: { findUnique: async () => config,
      create: async ({data}: {data: {ratePercent: string}}) => { configCreated++; config = { id: "cfg", revision: 1, ratePercent: data.ratePercent }; return config; },
      update: async ({data}: {data: {ratePercent: string}}) => { config = {...config!,ratePercent:data.ratePercent,revision:config!.revision+1}; return config; } },
    productPercentageParticipant: { createMany: async () => ({}) },
    task: { findFirst: async () => null },
    productStatusHistory: { findFirst: async () => null, create: async () => ({}) },
    payrollEntry: { create: async () => { payrollCreated++; return {}; } },
    changeLog: { findUnique: async () => null, create: async () => ({}) },
    domainEvent: { create: async () => ({ id: "event" }) },
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
  const patched = await patchProductPercentageCore(actor, {productId:"p",kind:"ENGINEERING",field:"ratePercent",value:"10",expectedValue:null,expectedRevision:0,clientMutationId:randomUUID()},tx);
  assert.equal(patched.ok,true); if(patched.ok) assert.equal(patched.revision,1);
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
      ratePercent: "10", participants: [{ userId: "engineer", shareUnits: 1000000 }], expectedRevision: 0 }, tx), /одиночное поле/);
    const before = structuredClone(completion);
    const revision = config!.revision;
    const result = await patchProductPercentageCore(actor,{productId:"p",kind:"ENGINEERING",field:"ratePercent",value:String(10+revision),expectedValue:config!.ratePercent,expectedRevision:revision,clientMutationId:randomUUID()},tx);
    assert.equal(result.ok,true); assert.deepEqual(completion,before);
    assert.equal(snapshotsCreated,0); assert.equal(payrollCreated,0);
  }
});

test("SKIPPED editor показывает позднюю конфигурацию отдельно от frozen history", async () => {
  const database = {
    task: { findMany: async () => [] },
    productPercentageParticipant: { findMany: async () => [] },
    product: { findFirst: async () => ({ id: "p", quantity: 3, noModel: false, engineerId: "new", engineer: { name: "Новый",active: true,roles:["ENGINEER"] },
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
  assert.equal(section.productCurrency, "USD"); assert.equal(section.payrollCurrency, null); assert.equal(section.total, null);
  assert.equal(section.currentRatePercent,"10"); assert.equal(section.assignee?.userId,"new");
  assert.deepEqual(section.members.map((member) => [member.userId, member.shareUnits, member.amount]), [["old", 1000000, null]]);
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

test("foreign frozen PENDING_FX retry preserves currency and fixed BYN amounts without duplicate payroll", async () => {
  const h = settlementHarness("1000", "5");
  h.completion.productCurrency = "USD";
  h.completion.payrollCurrency = "EUR";
  const deps = { ...h.deps, resolveRates: async (productCurrency: string, payrollCurrency: string, date: Date) => {
    assert.equal(productCurrency, "USD"); assert.equal(payrollCurrency, "EUR");
    assert.equal(date.toISOString(), h.completedAt.toISOString());
    return { asOf: "2026-09-30", product: { currency: "USD" as const, rate: "3.000000", date: "2026-09-30" },
      payroll: { currency: "EUR" as const, rate: "4.000000", date: "2026-09-30" } };
  } };
  assert.equal(await settlePendingProductPercentage("p", "ENGINEERING", deps), "SETTLED");
  assert.equal(h.completion.productCurrency, "USD"); assert.equal(h.completion.payrollCurrency, "EUR");
  const entries = h.entries as { amount: string; bynAmount: string; currency: string; projectCurrency: string }[];
  assert.equal(entries.length, 2);
  assert.equal(entries.reduce((sum, row) => sum + Number(row.bynAmount), 0), 150);
  assert.ok(entries.every(row => row.currency === "EUR" && row.projectCurrency === "USD"));
  assert.equal(await settlePendingProductPercentage("p", "ENGINEERING", deps), "SETTLED");
  assert.equal(entries.length, 2);
});

test("server DTO draft preview uses engineer unit price and batch price for assembler/mounter without legacy reads", async () => {
  const product = {id:"p",quantity:3,expectedPrice:"1000",project:{currency:"BYN"},noModel:false,files:[],stagePayPools:[],percentageCompletions:[],
    engineerId:"e",engineer:{name:"E",active:true,roles:["ENGINEER"]},assemblerId:"a",assembler:{name:"A",active:true,roles:["WORKER"]},mounterId:"m",mounter:{name:"M",active:true,roles:["MOUNTER"]},
    percentageConfigs:[{kind:"ENGINEERING",ratePercent:"5",revision:1},{kind:"ASSEMBLY",ratePercent:"4",revision:1},{kind:"INSTALLATION",ratePercent:"7",revision:1}]};
  const database = {task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>{throw Error("no legacy pay read")}}} as unknown as Parameters<typeof getProductPercentageView>[2];
  const view=await getProductPercentageView({id:"manager",roles:["MANAGER"]},"p",database);
  assert.deepEqual(Object.values(view.sections).map(section=>section.total),["50.00","120.00","210.00"]);
  assert.ok(Object.values(view.sections).every(section=>section.calculationVersion===4&&!('workReview' in section)&&!('legacyWorkCandidates' in section)));
  product.quantity=6;
  const changed=await getProductPercentageView({id:"manager",roles:["MANAGER"]},"p",database);
  assert.deepEqual(Object.values(changed.sections).map(section=>section.total),["50.00","240.00","420.00"]);
});
