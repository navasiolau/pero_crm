import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { matches, type FixtureRow as Row } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url);
let actions: typeof import("../src/server/products/actions");
let state: { products: Row[]; pools: Row[]; completions: Row[]; history: Row[]; logs: Row[]; events: Row[] };
let failPool = false;
const users = [{ id: "engineer", roles: ["ENGINEER"], active: true }, { id: "worker", roles: ["WORKER"], active: true }, { id: "inactive", roles: ["ENGINEER"], active: false }];
function reset() { state = { products: [], pools: [], completions: [], history: [], logs: [], events: [] }; failPool = false; }
function seed(status = "DESIGN", poolState = "DRAFT") {
  state.products.push({ id: "product", projectId: "project", number: "1.1", suffixInt: 1, title: "Product", quantity: 1, engineerId: "engineer", expectedPrice: "100", status, noModel: false });
  state.pools.push({ id: "pool", productId: "product", kind: "ENGINEERING", state: poolState, revision: 0 });
}
function product(where: Row) {
  const row = state.products.find((item) => matches({...item,project:{deletedAt:null}}, where));
  return row ? { ...row, stagePayPools: state.pools.filter((pool) => pool.productId === row.id),
    project: { currency: "BYN" }, percentageConfigs: [], files: [], works: [],
    _count: { tasks: 0, works: 0, projectMaterials: 0, stockMovements: 0 } } : null;
}
function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
}
const db = {
  $queryRaw: async () => [{ locked: 1 }],
  task: { findMany: async () => [], findFirst: async () => null },
  user: { findFirst: async ({ where }: { where: Row }) => users.find((row) => matches(row, where)) ?? null },
  project: { findUnique: async () => ({ id: "project", number: "1", currency: "BYN" }) },
  product: {
    findMany: async () => state.products,
    findUnique: async ({ where }: { where: Row }) => product(where), findFirst: async ({ where }: { where: Row }) => product(where),
    create: async ({ data }: { data: Row }) => { const row = { id: "created", status: "DESIGN", ...data }; state.products.push(row); return row; },
    update: async ({ where, data }: { where: Row; data: Row }) => { const row = state.products.find((item) => matches({...item,project:{deletedAt:null}}, where))!; apply(row, data); return row; },
    delete: async ({ where }: { where: Row }) => { state.products = state.products.filter((item) => !matches({...item,project:{deletedAt:null}}, where)); },
  },
  productStagePayPool: {
    findUnique: async ({ where }: { where: Row }) => state.pools.find((item) => matches(item, (where.productId_kind ?? where) as Row)) ?? null,
    create: async ({ data }: { data: Row }) => { if (failPool) throw new Error("Injected pool failure"); const row = { id: "pool-created", revision: 0, ...data }; state.pools.push(row); return row; },
    count: async ({ where }: { where: Row }) => state.pools.filter((item) => matches({...item,project:{deletedAt:null}}, where)).length,
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const rows = state.pools.filter((item) => matches({...item,project:{deletedAt:null}}, where)); rows.forEach((item) => apply(item, data)); return { count: rows.length }; },
    deleteMany: async ({ where }: { where: Row }) => { state.pools = state.pools.filter((item) => !matches({...item,project:{deletedAt:null}}, where)); },
  },
  productPercentageCompletion: {
    findUnique: async ({ where }: { where: Row }) => state.completions.find((row) => matches(row,
      (where.productId_kind ?? where) as Row)) ?? null,
    create: async ({ data }: { data: Row }) => { const row = { id: `completion-${state.completions.length}`, ...data }; state.completions.push(row); return row; },
    count: async ({ where }: { where: Row }) => state.completions.filter((row) => matches(row, where)).length,
  },
  productPercentageConfig: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  productPercentageParticipant: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  orgSetting: { findUnique: async ({where}: {where: {key:string}}) => where.key === "payrollCurrency" ? ({value:"BYN"}) : null },
  productStatusHistory: {
    findFirst: async ({ where }: { where: Row }) => state.history.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: { data: Row }) => { state.history.push(data); return data; },
  },
  changeLog: { create: async ({ data }: { data: Row }) => { state.logs.push(data); return data; } },
  domainEvent: { create: async ({ data }: { data: Row }) => { const row = { id: "event", ...data }; state.events.push(row); return row; } },
  $transaction: async (operation: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => {
    const before = structuredClone(state);
    try { return Array.isArray(operation) ? await Promise.all(operation) : await operation(db); }
    catch (error) { state = before; throw error; }
  },
};
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), stub = new Module(filename);
  stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
before(() => {
  reset(); (globalThis as { prisma?: PrismaClient }).prisma = db as unknown as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "Manager", roles: ["MANAGER"] } }) });
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {} });
  actions = require("../src/server/products/actions");
});

test("новое изделие создаётся без фиктивного старого инженерного фонда", async () => {
  reset(); assert.ok((await actions.createProduct({ projectId: "project", title: "New", engineerId: "engineer" })).ok);
  assert.equal(state.pools.length, 0);
  assert.equal(state.products[0].status, "DESIGN");
});

test("primary engineer assignment requires an active ENGINEER role", async () => {
  for (const engineerId of ["worker", "inactive"]) {
    reset(); assert.equal((await actions.createProduct({ projectId: "project", title: "New", engineerId })).ok, false);
    assert.equal(state.products.length, 0);
  }
});

test("менеджер меняет статус независимо от старого DRAFT фонда и фиксирует первый пропуск", async () => {
  for (const from of ["DESIGN", "RECLAMATION"]) for (const to of ["PRODUCTION", "STORAGE", "INSTALLATION", "DONE"] as const) {
    reset(); seed(from);
    assert.equal((await actions.changeProductStatus("product", to)).ok, true);
    assert.equal(state.products[0].status, to);
    assert.equal(state.completions.filter((row) => row.kind === "ENGINEERING").length, 1);
    assert.equal(state.completions.filter((row) => row.kind === "INSTALLATION").length, to === "DONE" ? 1 : 0);
    assert.ok(state.completions.every((row) => row.state === "SKIPPED_ONCE"));
  }
});

test("price changes invalidate draft pool forms but never rewrite a settled pool", async () => {
  reset(); seed(); assert.ok((await actions.updateProduct("product", { expectedPrice: 120 }, { expectedPrice: "100" })).ok);
  assert.equal(state.pools[0].revision, 1);
  reset(); seed("PRODUCTION", "SETTLED"); const pool = structuredClone(state.pools[0]);
  assert.ok((await actions.updateProduct("product", { expectedPrice: 120 }, { expectedPrice: "100" })).ok);
  assert.deepEqual(state.pools[0], pool);
});

test("legacy string-only deletion refuses without CAS and preserves both draft and settled history", async () => {
  const originalDelete=db.product.delete,originalPoolDelete=db.productStagePayPool.deleteMany,
    originalConfigDelete=db.productPercentageConfig.deleteMany,originalParticipantDelete=db.productPercentageParticipant.deleteMany;
  let physicalCalls=0;
  db.product.delete=async()=>{physicalCalls++;};db.productStagePayPool.deleteMany=async()=>{physicalCalls++;};
  db.productPercentageConfig.deleteMany=async()=>{physicalCalls++;return{count:0};};db.productPercentageParticipant.deleteMany=async()=>{physicalCalls++;return{count:0};};
  try{
    for(const poolState of ["DRAFT","SETTLED"]){
      reset();seed(poolState==="DRAFT"?"DESIGN":"PRODUCTION",poolState);const before=structuredClone(state);
      const result=await actions.deleteProduct("product");assert.equal(result.ok,false);
      if(!result.ok)assert.equal(result.kind,"validation");
      assert.deepEqual(state,before);assert.equal(state.products.length,1);assert.equal(state.pools.length,1);assert.equal(physicalCalls,0);
    }
  }finally{db.product.delete=originalDelete;db.productStagePayPool.deleteMany=originalPoolDelete;db.productPercentageConfig.deleteMany=originalConfigDelete;db.productPercentageParticipant.deleteMany=originalParticipantDelete;}
});
