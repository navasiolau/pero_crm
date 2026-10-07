import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, beforeEach, test } from "node:test";
import type { Role } from "@prisma/client";

const require = createRequire(import.meta.url);
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier);
  const stub = new Module(filename);
  stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
}
let roles: Role[] = ["MANAGER"];
let state = initial();
let warehousePhase:string|undefined;
const locks: string[] = [];
function initial() {
  return {
    product: { id: "p", projectId: "j", title: "Стул", number: "900001.1", quantity: 5,
      expectedPrice: "200", initialPrice: null, engineerId: null },
    work: { id: "w", title: "Сборка", productId: "p", quantity: "5", quantityPerUnit: "1", priceSnapshot: "30", total: "150", paymentKind: "LEGACY",
      tasks: [{ quantity: "4", allocationGroupId: "g" }, { quantity: "4", allocationGroupId: "g" }] },
    material: { id: "m", productId: "p", materialId: "hinge", quantity: "20", quantityPerUnit: "4", issuedQty: "8",
      material: { name: "Петли" }, product: { quantity: 5, projectId: "j" }, comment: null },
    facts: { payroll: [{ amount: "10", priceSnapshot: "200", state: "PENDING_FX" }], movement: [{ quantity: "8", totalByn: "16" }], time: [{ minutes: 42 }] },
    addedWork: null as Record<string, unknown> | null,
  };
}
let products: typeof import("../src/server/products/actions");
let works: typeof import("../src/server/works/actions");
let materials: typeof import("../src/server/warehouse/actions");

before(() => {
  const db = {
    product: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => where.id && where.id !== "p" ? null : { ...state.product },
      findUnique: async () => ({ ...state.product }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.product, data),
    },
    project: { findUnique: async () => ({ id: "j", number: "900001", currency: "BYN" }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    task: { findMany: async () => [] },
    user:{findUnique:async()=>({id:"manager",name:"QA",active:true,roles})},
    changeLog: { create: async () => ({}) },
    priceItem: { findUnique: async () => ({ id: "price", name: "Сборка", unit:"шт.",price: "30", active: true }) },
    work: {
      findMany: async () => [structuredClone(state.work)],
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.work, data),
      create: async ({ data }: { data: Record<string, unknown> }) => { state.addedWork = data; return { ...data, id: "added" }; },
    },
    projectMaterial: {
      findMany: async () => [structuredClone(state.material)],
      findUnique: async () => structuredClone({ ...state.material, product: { ...state.material.product, quantity: state.product.quantity } }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.material, data),
      upsert: async ({ update }: { update: Record<string, unknown> }) => Object.assign(state.material, update),
    },
    material: { findUnique: async () => ({ id: "hinge", name: "Петли", active: true }) },
    productStagePayPool: { updateMany: async () => { throw new Error("Percentage preview must not change on quantity"); } },
    $queryRaw: async (strings: TemplateStringsArray) => { const sql=strings.join("?");locks.push(sql);return sql.includes('"WarehouseAccountingState"')?(warehousePhase?[{phase:warehousePhase}]:[]):[{id:"p"}]; },
    $transaction: async <T>(operation: (tx: unknown) => Promise<T>) => {
      const before = structuredClone(state);
      try { return await operation(db); } catch (error) { state = before; throw error; }
    },
  };
  inject("../src/lib/prisma", { prisma: db });
  inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "QA", roles } }) });
  inject("../src/server/require-role", { requireRole: async () => ({ user: { id: "manager", name: "QA", roles } }) });
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {} });
  products = require("../src/server/products/actions");
  works = require("../src/server/works/actions");
  materials = require("../src/server/warehouse/actions");
});
beforeEach(() => { state = initial(); roles = ["MANAGER"]; warehousePhase=undefined;locks.length = 0; });

test("real product action changes both plans, never touches facts and takes allocation lock first", async () => {
  const facts = JSON.stringify(state.facts); const tasks = JSON.stringify(state.work.tasks);
  assert.deepEqual(await products.updateProduct("p", { quantity: 6 }, { quantity: 5 }), { ok: true });
  assert.equal(state.product.quantity, 6);
  assert.equal(state.work.quantity, "6.00"); assert.equal(state.work.total, "180.00");
  assert.equal(state.material.quantity, "24.000");
  assert.equal(JSON.stringify(state.facts), facts); assert.equal(JSON.stringify(state.work.tasks), tasks);
  assert.match(locks[0], /pg_advisory_xact_lock/);
  assert.match(locks[1], /pg_advisory_xact_lock_shared/);
  assert.match(locks[3], /Product.*FOR UPDATE/);
});

test('warehouse freeze blocks norms and quantity rescaling while other product edits continue',async()=>{
 for(const phase of ['FROZEN','VERIFYING']){
  warehousePhase=phase;
  const before=JSON.stringify(state);
  for(const change of [()=>products.updateProduct('p',{quantity:6},{quantity:5}),()=>materials.updateProjectMaterial({id:'m',quantityPerUnit:5}),()=>materials.deleteProjectMaterial('m')]){
   const result=await change();assert.equal(result.ok,false);assert.match(result.error!,/Склад временно закрыт/);
  }
  assert.equal(JSON.stringify(state),before);
 }
 assert.deepEqual(await products.updateProduct('p',{title:'Новый стул'},{title:state.product.title}),{ok:true});
});
test("real action rejects partial reduction and keeps all rows byte-identical", async () => {
  const baseline = JSON.stringify(state);
  const workFailure = await products.updateProduct("p", { quantity: 3 }, { quantity: 5 });
  assert.equal(workFailure.ok, false); assert.match(workFailure.error!, /Сборка/);
  assert.equal(JSON.stringify(state), baseline);
  state.work.tasks = [];
  const second = JSON.stringify(state);
  const materialFailure = await products.updateProduct("p", { quantity: 1 }, { quantity: 5 });
  assert.equal(materialFailure.ok, false); assert.match(materialFailure.error!, /Петли/);
  assert.equal(JSON.stringify(state), second);
});
test("real action permits reducing group of two participants to shared volume four", async () => {
  assert.equal((await products.updateProduct("p", { quantity: 4 }, { quantity: 5 })).ok, true);
  assert.equal(state.work.quantity, "4.00"); assert.equal(state.material.quantity, "16.000");
});
test("quantity action rejects forbidden role and malformed counts without writes", async () => {
  const baseline = JSON.stringify(state);
  roles = ["ENGINEER"];
  assert.equal((await products.updateProduct("p", { quantity: 6 }, { quantity: 5 })).ok, false);
  roles = ["MANAGER"];
  for (const quantity of [0, -1, 1.5]) assert.equal((await products.updateProduct("p", { quantity }, { quantity: 5 })).ok, false);
  assert.equal(JSON.stringify(state), baseline);
});
test("real addWork action scales explicit unit norm and rejects stale total input", async () => {
  assert.equal((await works.addWork({ projectId: "j", productId: "p", priceItemId: "price", quantity: 1 })).ok, false);
  assert.equal(state.addedWork, null);
  assert.equal((await works.addWork({ projectId: "j", productId: "p", priceItemId: "price", quantityPerUnit: 1 })).ok, true);
  const added = state.addedWork as Record<string, unknown> | null;
  assert.equal(added?.quantity, "5.00"); assert.equal(added?.total, "150.00");
});
test("real material actions add per-unit quantities and preserve issued facts", async () => {
  assert.equal((await materials.addProjectMaterial({ productId: "p", materialId: "hinge", quantityPerUnit: 1 })).ok, true);
  assert.equal(state.material.quantityPerUnit, "5.000"); assert.equal(state.material.quantity, "25.000");
  assert.equal(state.material.issuedQty, "8");
  assert.equal((await materials.updateProjectMaterial({ id: "m", quantityPerUnit: 1 })).ok, false);
  assert.equal((await materials.updateProjectMaterial({ id: "m", quantityPerUnit: 2 })).ok, true);
  assert.equal(state.material.quantity, "10.000"); assert.equal(state.material.issuedQty, "8");
});
