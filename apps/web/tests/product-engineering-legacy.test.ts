import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient,ProjectStage } from "@prisma/client";
import type { DomainActor } from "../src/server/projects/core";
import { matches, type FixtureRow as Row } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url);
const actor: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };
let core: typeof import("../src/server/projects/core");
let state: ReturnType<typeof initial>;
let failPayroll = false;
let sequence = 0;
let tail = Promise.resolve();
function initial() {
  return {
    project: { id: "project", number: "1", title: "Project", stage: "LEAD" } as Row,
    products: [
      { id: "old", projectId: "project", engineerId: "engineer", expectedPrice: "100" },
      { id: "new", projectId: "project", engineerId: "engineer", expectedPrice: "1000" },
    ] as Row[],
    pools: [{ id: "pool", productId: "new", kind: "ENGINEERING", state: "DRAFT", ratePercent: "5" }] as Row[],
    entries: [] as Row[], histories: [] as Row[], logs: [] as Row[], events: [] as Row[],
  };
}
function reset() { state = initial(); failPayroll = false; sequence = 0; tail = Promise.resolve(); }
const tx = {
  $queryRaw: async () => [{ locked: 1 }],
  project: {
    findUnique: async () => structuredClone(state.project),
    update: async ({ data }: { data: Row }) => Object.assign(state.project, data),
    updateMany:async({where,data}:{where:Row;data:Row})=>{if(!matches(state.project,where))return{count:0};Object.assign(state.project,data);return{count:1};},
  },
  product: { findMany: async ({ where }: { where: Row }) => state.products.filter((row) => {
    const { stagePayPools, ...base } = where;
    return matches(row, base) && (!stagePayPools || !state.pools.some((pool) => pool.productId === row.id && pool.kind === "ENGINEERING"));
  }) },
  user: { findUnique: async () => ({ id: "engineer", name: "Engineer", payScheme: "PERCENT_PROJECT", payPercent: "5" }) },
  orgSetting: { findUnique: async () => ({ value: "BYN" }) },
  payrollEntry: {
    findFirst: async () => state.entries[0] ?? null,
    create: async ({ data }: { data: Row }) => {
      if (failPayroll) throw new Error("Injected payroll failure");
      const row = { id: `pay-${++sequence}`, ...data, amount: String(data.amount) }; state.entries.push(row); return row;
    },
  },
  productStagePayPool: {
    create: async ({ data }: { data: Row }) => { const row = { id: `pool-${++sequence}`, ...data }; state.pools.push(row); return row; },
  },
  projectStageHistory: { create: async ({ data }: { data: Row }) => { state.histories.push(data); return data; } },
  changeLog: { findUnique:async({where}:{where:Row})=>state.logs.find(row=>matches(row,where))??null, create: async ({ data }: { data: Row }) => { state.logs.push(data); return data; } },
  domainEvent: { create: async ({ data }: { data: Row }) => { const row = { id: `event-${++sequence}`, ...data }; state.events.push(row); return row; } },
};
const database = {
  ...tx,
  $transaction: async (operation: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) => {
    if (Array.isArray(operation)) return Promise.all(operation);
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; });
    await previous; const before = structuredClone(state);
    try { return await operation(tx); }
    catch (error) { state = before; throw error; }
    finally { release(); }
  },
};
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), item = new Module(filename);
  item.exports = exports; item.filename = filename; item.loaded = true; require.cache[filename] = item;
}
before(() => {
  reset(); (globalThis as { prisma?: PrismaClient }).prisma = database as unknown as PrismaClient;
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
  inject("../src/server/payroll/queries", { getPayrollCurrency: async () => "BYN" });
  core = require("../src/server/projects/core");
});

test("IN_WORK не создаёт новых процентов или protective pool, включая старую конфигурацию", async () => {
  reset(); const expectedStage=state.project.stage as ProjectStage; assert.ok((await core.changeProjectStageCore(actor, "project", "IN_WORK",undefined,expectedStage,randomUUID())).ok);
  assert.equal(state.entries.length, 0);
  assert.equal(state.pools.length, 1);
  assert.equal(state.pools.find((pool) => pool.productId === "new")?.state, "DRAFT");
});

test("движение проекта не вызывает старый payroll writer", async () => {
  reset(); failPayroll = true;
  const expectedStage=state.project.stage as ProjectStage;
  assert.ok((await core.changeProjectStageCore(actor, "project", "IN_WORK",undefined,expectedStage,randomUUID())).ok);
  assert.equal(state.project.stage, "IN_WORK");
  assert.equal(state.histories.length, 1);
  assert.equal(state.entries.length, 0);
});

test("параллельные переходы дают одну историю без legacy начисления", async () => {
  reset();
  const expectedStage=state.project.stage as ProjectStage;
  const result = await Promise.all([core.changeProjectStageCore(actor, "project", "IN_WORK",undefined,expectedStage,randomUUID()), core.changeProjectStageCore(actor, "project", "IN_WORK",undefined,expectedStage,randomUUID())]);
  assert.equal(result.filter(item=>item.ok).length,1);
  assert.match(result.find(item=>!item.ok)?.error??"",/изменён другим пользователем/);
  assert.equal(state.entries.length, 0); assert.equal(state.histories.length, 1);
  assert.equal(state.pools.filter((pool) => pool.productId === "old").length, 0);
});

test("previous legacy history is not edited or charged again on return to IN_WORK", async () => {
  reset(); state.entries.push({ id: "historic", projectId: "project", scheme: "PERCENT_PROJECT", amount: "321", currency: "USD" });
  const original = structuredClone(state.entries);
  const expectedStage=state.project.stage as ProjectStage;
  assert.ok((await core.changeProjectStageCore(actor, "project", "IN_WORK",undefined,expectedStage,randomUUID())).ok);
  assert.deepEqual(state.entries, original);
});

test("no positive legacy charge means no invented coverage marker", async () => {
  reset(); state.products[0].expectedPrice = "0";
  const expectedStage=state.project.stage as ProjectStage;
  assert.ok((await core.changeProjectStageCore(actor, "project", "IN_WORK",undefined,expectedStage,randomUUID())).ok);
  assert.equal(state.entries.length, 0);
  assert.equal(state.pools.length, 1);
});


test("повтор параллельной доставки одного UUID сохраняет статус один раз без legacy начисления",async()=>{
 reset();const expectedStage=state.project.stage as ProjectStage;const clientMutationId=randomUUID();
 const results=await Promise.all([core.changeProjectStageCore(actor,"project","IN_WORK",undefined,expectedStage,clientMutationId),core.changeProjectStageCore(actor,"project","IN_WORK",undefined,expectedStage,clientMutationId)]);
 assert.ok(results.every(result=>result.ok));assert.equal(state.histories.length,1);assert.equal(state.logs.length,1);assert.equal(state.events.length,1);assert.equal(state.entries.length,0);assert.equal(state.pools.length,1);assert.equal(state.pools.filter(pool=>pool.productId==='old').length,0);
});
