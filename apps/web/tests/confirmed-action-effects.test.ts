import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import * as React from "react";
const { createElement } = React;
import { renderToStaticMarkup } from "react-dom/server";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";
import { taskShareFixture } from "./helpers/task-share-fixture";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import type { PaymentInput } from "../src/server/payments/contracts";

const require = createRequire(import.meta.url), originals = new Map<string, NodeJS.Module | undefined>();
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name); originals.set(file, require.cache[file]);
  const stubModule = new Module(file); stubModule.loaded = true; stubModule.filename = file; stubModule.exports = exports; require.cache[file] = stubModule;
}
type Row = Record<string, unknown>;
let rows: Row[] = [], logs: Row[] = [], events: Row[] = [], sequence = 0, fault: string | null = null, loseAck = false, failProof = false;
let workFixture: ReturnType<typeof taskShareFixture> | null = null;
let receiptReads: ("hidden" | "error")[] = [];
let alternateTransaction: ((operation: (database: typeof tx) => Promise<unknown>) => Promise<unknown>) | null = null;
const calls: string[] = [];
const effect = (name: string) => { calls.push(name); if (fault === name) throw Error("Injected effect failure"); };
const tx = {
  $queryRaw: async () => [{ locked: 1 }],
  payment: { create: async ({ data }: { data: Row }) => { const row = { id: "payment-" + ++sequence, deletionId: null, ...data }; rows.push(row); return row; },
    findUnique: async ({ where }: { where: { id: string } }) => { if (failProof) throw Error("Injected proof read failure"); return rows.find(row => row.id === where.id) ?? null; } },
  changeLog: { create: async ({ data }: { data: Row }) => { const row = { id: "audit-" + ++sequence, ...data }; logs.push(row); return row; },
    findUnique: async ({ where }: { where: { id: string } }) => { const mode = receiptReads.shift(); if (mode === "hidden") return null;
      if (failProof || mode === "error") throw Error("Injected proof read failure"); return logs.find(row => row.id === where.id) ?? null; } },
  domainEvent: { create: async ({ data }: { data: Row }) => { const row = { id: "event-" + ++sequence, ...data }; events.push(row); return row; },
    findUnique: async ({ where }: { where: { id: string } }) => events.find(row => row.id === where.id) ?? null },
  project: { findUnique: async () => null }, cashAccount: { findUnique: async () => ({ id: "cash", active: true, currency: "BYN", name: "QA cash" }) },
  expenseArticle: { findUnique: async () => null },
};
inject("../src/lib/prisma", { prisma: tx });
inject("next/cache", { revalidatePath: (path: string) => effect("cache:" + path) });
inject("../src/server/plugins/events", { dispatchEvent: async () => effect("dispatch") });
inject("../src/server/notifications/notify", { notifyOrg: async () => effect("org") });
inject("../src/server/tasks/transaction", { withTaskTransaction: async (operation: (database: typeof tx) => Promise<unknown>) => {
  if (alternateTransaction) return alternateTransaction(operation);
  if (workFixture) return workFixture.transaction(operation as unknown as Parameters<TaskTransaction>[0]);
  const before = structuredClone({ rows, logs, events, sequence });
  let value;
  try { value = await operation(tx); } catch (error) { ({ rows, logs, events, sequence } = before); throw error; }
  if (loseAck) { loseAck = false; if (fault === "proof") failProof = true; throw Error("Injected lost commit ACK"); }
  return value;
} });
const payment = require("../src/server/payments/core").createPaymentCore as (actor: object, input: PaymentInput) => Promise<{ ok: boolean; resultId?: string; paymentId?: string; outcome?: string; retrySafe?: boolean }>;
const actor = { id: "accountant", name: "QA", roles: ["ACCOUNTANT"], source: "web" };
function reset() { alternateTransaction = null; receiptReads = []; workFixture = null; rows = []; logs = []; events = []; sequence = 0; fault = null; loseAck = false; failProof = false; calls.length = 0; }
const input = (): PaymentInput => ({ direction: "INCOME", amount: 100, currency: "BYN", cashAccountId: "cash", clientMutationId: randomUUID() });
after(() => { for (const [file, prior] of originals) if (prior) require.cache[file] = prior; else delete require.cache[file]; });

test("payment cache and notification faults preserve original ACK and result ID", async () => {
  for (const name of ["cache:/finance/income", "cache:/finance/expenses", "cache:/finance/payroll", "cache:/finance/accounts", "dispatch", "org"]) {
    reset(); fault = name; const data = input(); const result = await payment(actor, data);
    assert.equal(result.ok, true); assert.equal(result.resultId, rows[0]?.id); assert.equal(result.paymentId, result.resultId); assert.equal(result.outcome, "COMMITTED");
    assert.equal(rows.length, 1); assert.equal(events.length, 1); assert.equal(calls.length, 6);
    const previous = structuredClone({ rows, logs, events }); calls.length = 0;
    const replay = await payment(actor, data); assert.equal(replay.resultId, result.resultId);
    assert.deepEqual({ rows, logs, events }, previous); assert.equal(calls.length, 0);
  }
});

test("payment lost ACK is verified from exact existing receipt", async () => {
  reset(); loseAck = true; const data = input(); const result = await payment(actor, data);
  assert.equal(result.ok, true); assert.equal(result.outcome, "COMMITTED"); assert.equal(result.paymentId, rows[0]?.id);
  assert.equal(rows.length, 1); assert.equal(events.length, 1);
});

test("failed receipt read preserves UNKNOWN and cannot rerun payment", async () => {
  reset(); loseAck = true; fault = "proof"; const result = await payment(actor, input());
  assert.equal(result.ok, false); assert.equal(result.outcome, "UNKNOWN"); assert.equal(result.retrySafe, true);
  assert.equal(rows.length, 1); assert.equal(events.length, 1); assert.equal(calls.length, 0);
});

test("mandatory removeWork audit failure rolls back the deleted work", async () => {
  reset(); workFixture = taskShareFixture();
  for (const task of workFixture.state().tasks) task.workId = null;
  workFixture.failOn("log.create");
  inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "QA", roles: ["MANAGER"] } }) });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => { throw Error("Injected transactional failure"); } });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => effect("cache:product") });
  const { removeWork } = require("../src/server/works/actions") as typeof import("../src/server/works/actions");
  await assert.rejects(removeWork("work"), /Injected/);
  assert.equal(workFixture.state().works.length, 1); assert.equal(workFixture.state().logs.length, 0); assert.equal(calls.length, 0);
});

test("new internal task receipts do not occupy visible audit slots or leak payload", async () => {
  reset();
  const uniqueId = "task-status:00000000-0000-4000-8000-000000000099";
  const base = { createdAt: new Date("2026-10-11T00:00:00Z"), actorType: "user", actorName: "QA", actorId: "manager", entity: "task", entityId: "source", source: "web", field: null, oldValue: null };
  const records: FixtureRow[] = Array.from({ length: 205 }, (_, index) => ({ ...base, id: index ? "task-status:internal-" + index : uniqueId,
    action: "task.status.request", newValue: { fingerprint: "internal-secret-fingerprint", clientMutationId: uniqueId } }));
  records.push({ ...base, id: "business-status", action: "status", field: "status", oldValue: "IN_PROGRESS", newValue: "DONE" },
    { ...base, id: "task-status:business", action: "update", newValue: "kept-business" },
    { ...base, id: "task-status:other", entity: "other", action: "task.status.request", newValue: "kept-other" });
  function evaluate(row: FixtureRow, where: FixtureRow = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "NOT") return !evaluate(row, value as FixtureRow);
      if (key === "AND") return (Array.isArray(value) ? value : [value]).every(item => evaluate(row, item as FixtureRow));
      if (key === "OR") return (value as FixtureRow[]).some(item => evaluate(row, item));
      if (value && typeof value === "object" && "startsWith" in value) return String(row[key]).startsWith(String(value.startsWith));
      return matches(row, { [key]: value });
    });
  }
  Object.assign(tx.changeLog, { findMany: async ({ where, take }: { where: FixtureRow; take: number }) => records.filter(row => evaluate(row, where)).slice(0, take) });
  inject("../src/server/require-role", { requireRole: async (roles: string[]) => { assert.deepEqual(roles, ["ADMIN"]); } });
  const { listGlobalChangeLog } = require("../src/server/changelog/queries") as typeof import("../src/server/changelog/queries");
  const result = await listGlobalChangeLog({ actor: "qA", entity: "task" });
  assert.deepEqual(result.map(row => row.id), ["business-status", "task-status:business"]);
  assert.equal(result.filter(row => row.action === "status").length, 1);
  const all = await listGlobalChangeLog({}); assert.equal(all.some(row => row.id === "task-status:other"), true);
  const { ChangelogTable } = require("../src/app/(app)/changelog/changelog-table") as typeof import("../src/app/(app)/changelog/changelog-table");
  const reactGlobal = globalThis as typeof globalThis & { React?: typeof React };
  const priorReact = reactGlobal.React; reactGlobal.React = React;
  let html: string;
  try { html = renderToStaticMarkup(createElement(ChangelogTable, { entries: result.map(row => ({ ...row, actorName: row.actorName ?? "", createdAt: row.createdAt.toISOString(), source: row.source ?? "web" })) })); }
  finally { if (priorReact) reactGlobal.React = priorReact; else Reflect.deleteProperty(reactGlobal, "React"); }
  assert.ok(html.includes("DONE")); assert.ok(!html.includes(uniqueId)); assert.ok(!html.includes("internal-secret-fingerprint"));
  assert.equal(records.length, 208, "receipt rows must not be removed");
});

test("previous committed payment survives a racing retry receipt-read abort", async () => {
  reset(); const data = input(); const original = await payment(actor, data); assert.equal(original.ok, true);
  const before = structuredClone({ rows, logs, events }); calls.length = 0;
  receiptReads = ["hidden", "error"]; // Preflight missed a concurrent commit; callback read loses its answer.
  const replay = await payment(actor, data);
  assert.equal(replay.ok, true); assert.equal(replay.resultId, original.resultId); assert.equal(replay.outcome, "COMMITTED");
  assert.deepEqual({ rows, logs, events }, before); assert.equal(calls.length, 0);
});

test("preflight IO is UNKNOWN while typed changed-payload and deleted receipt remain rejections", async () => {
  reset(); const data = input(); await payment(actor, data); const before = structuredClone({ rows, logs, events });
  receiptReads = ["error"]; const unknown = await payment(actor, data); assert.equal(unknown.outcome, "UNKNOWN");
  const changed = await payment(actor, { ...data, amount: 101 }); assert.equal(changed.ok, false); assert.notEqual(changed.outcome, "UNKNOWN");
  rows[0].deletionId = "deletion"; const deleted = await payment(actor, data); assert.equal(deleted.ok, false); assert.notEqual(deleted.outcome, "UNKNOWN");
  rows[0].deletionId = null; assert.deepEqual({ rows, logs, events }, before);
});
test("actual bot payment route preserves UNKNOWN/receipt ACK and auth gates", async () => {
  reset(); let denied = false;
  inject("../src/server/api/auth", { authenticate: async (_request: Request, scope: string) => { assert.equal(scope, "write"); return denied ? new Response("denied", { status: 403 }) : {}; }, isErrorResponse: (value: unknown) => value instanceof Response });
  inject("../src/server/telegram/bot-api", { resolveBotActor: async () => ({ ...actor, source: "telegram" }), isActorError: (value: unknown) => value instanceof Response, requireBotFinance: () => null, domainError: () => Response.json({ ok: false, error: "error" }, { status: 403 }) });
  const { POST } = require("../src/app/api/v1/bot/payments/route") as typeof import("../src/app/api/v1/bot/payments/route");
  const data = input(), request = () => new Request("https://qa.invalid/api/v1/bot/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  loseAck = true; fault = "proof";
  const uncertain = await POST(request()); const body = await uncertain.json() as { ok: boolean; outcome: string };
  assert.equal(uncertain.status, 200); assert.equal(body.ok, false); assert.equal(body.outcome, "UNKNOWN");
  assert.equal(rows.length, 1); failProof = false; fault = null;
  const replay = await POST(request()); const ack = await replay.json() as { ok: boolean; outcome: string; paymentId: string };
  assert.equal(ack.ok, true); assert.equal(ack.outcome, "COMMITTED"); assert.equal(ack.paymentId, rows[0].id); assert.equal(rows.length, 1);
  denied = true; assert.equal((await POST(request())).status, 403); assert.equal(rows.length, 1);
});

test("DI actual project-material wrappers keep mandatory audits atomic and isolate cache faults", async () => {
  let line: Row | null = null, audit: Row[] = [], auditFails = false;
  const product = { id: "product", projectId: "project", number: "P", quantity: 1 };
  const db = { changeLog: { create: async ({ data }: { data: Row }) => { if (auditFails) throw Error("audit failure"); audit.push(data); return data; } },
    projectMaterial: { findUnique: async () => line ? { ...line, material: { name: "QA material" }, product } : null,
      delete: async () => { const previous = line; line = null; return previous; } } };
  inject("../src/server/require-role", { requireRole: async () => ({ user: { id: "manager", name: "QA", roles: ["MANAGER"] } }) });
  inject("../src/server/warehouse/revalidate", { revalidateWarehouse: async () => effect("cache:warehouse") });
  inject("../src/server/warehouse/norm-core", {
    lockMaterialProduct: async () => {},
    addMaterialNorm: async () => { line = { id: "line", productId: "product", quantity: "2.000", quantityPerUnit: "2.000", issuedQty: "0" }; return { line, product, material: { name: "QA material" } }; },
    updateMaterialNorm: async () => { const previous = { ...line, product }; line = { ...line, quantity: "3.000", quantityPerUnit: "3.000" }; return { line: previous, quantity: "3.000", quantityPerUnit: "3.000" }; },
  });
  const { addProjectMaterial, updateProjectMaterial, deleteProjectMaterial } = require("../src/server/warehouse/actions") as typeof import("../src/server/warehouse/actions");
  const operations = [() => addProjectMaterial({ productId: "product", materialId: "material", quantity: 2 }),
    () => updateProjectMaterial({ id: "line", quantity: 3 }), () => deleteProjectMaterial("line")];
  for (let index = 0; index < operations.length; index++) {
    for (const failAudit of [true, false]) {
      reset(); audit = []; auditFails = failAudit;
      line = index ? { id: "line", productId: "product", quantity: "2.000", quantityPerUnit: "2.000", issuedQty: "0" } : null;
      const before = structuredClone(line); fault = failAudit ? null : "cache:warehouse";
      alternateTransaction = async operation => { const snapshot = structuredClone({ line, audit }); try { return await operation(db as unknown as typeof tx); }
        catch (error) { line = snapshot.line; audit = snapshot.audit; throw error; } };
      const result = await operations[index](); assert.equal(result.ok, !failAudit);
      if (failAudit) { assert.deepEqual(line, before); assert.equal(audit.length, 0); assert.equal(calls.length, 0); }
      else { assert.equal(audit.length, 1); assert.equal(audit[0].entity, "projectMaterial"); assert.equal(audit[0].source, "web"); assert.equal(calls.length, 1); }
    }
  }
});
test("DI actual product/work/movement wrappers preserve confirmed ACK for every effect fault", async () => {
  const fresh = <T,>(name: string): T => { const file = require.resolve(name); if (!originals.has(file)) originals.set(file, require.cache[file]); delete require.cache[file]; return require(name) as T; };
  inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "QA", roles: ["MANAGER"] } }) });
  const product = { id: "product", projectId: "project", number: "P", title: "QA", status: "DESIGN" };
  inject("../src/server/products/core", { createProductCore: async () => ({ ok: true, product }), updateProductCore: async () => ({ ok: true, before: product }), deleteProductCore: async () => ({ ok: false }), patchProductCore: async () => ({}) });
  inject("../src/server/products/status-core", { changeProductStatusTransaction: async () => ({ ok: true, product, eventId: "event", captured: [], percentageEffects: { earnings: [] } }) });
  inject("../src/server/product-percentage-pay/core", { settlePendingProductPercentage: async () => null, deliverProductPercentageEffects: async () => effect("percentage") });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => effect("cache:product") });
  const products = fresh<typeof import("../src/server/products/actions")>("../src/server/products/actions");
  for (const op of [() => products.createProduct({ projectId: "project", title: "QA" }), () => products.updateProduct("product", { title: "changed" })]) {
    for (const failure of ["cache:product", "cache:/projects"]) { reset(); fault = failure; assert.equal((await op()).ok, true); assert.deepEqual(calls, ["cache:product", "cache:/projects"]); }
  }
  for (const failure of ["percentage", "dispatch", "org", "cache:product", "cache:/projects"]) {
    reset(); fault = failure; const result = await products.changeProductStatus("product", "PRODUCTION");
    assert.equal(result.ok, true); assert.equal(result.financeState, null); assert.deepEqual(calls, ["percentage", "dispatch", "org", "cache:product", "cache:/projects"]);
  }
  reset(); fault = "cache:/";
  assert.equal((await products.updateProduct("product", { quantity: 2 })).ok, true); assert.equal(calls.length, 7);
  inject("../src/server/works/core", { addWorkCore: async () => ({ ok: true, workId: "work" }) });
  inject("../src/server/works/update-core", { updateWorkCore: async () => ({ ok: true, workId: "work" }) });
  const works = fresh<typeof import("../src/server/works/actions")>("../src/server/works/actions");
  const workOps = [() => works.addWork({ projectId: "project", productId: "product", priceItemId: "price", quantity: 1 }),
    () => works.updateWork({ projectId: "project", productId: "product", workId: "work", quantity: 2, expectedRevision: "a".repeat(64), clientMutationId: randomUUID() })];
  for (const op of workOps) for (const failure of ["cache:/projects/project", "cache:product"]) {
    reset(); fault = failure; assert.equal((await op()).ok, true); assert.deepEqual(calls, ["cache:/projects/project", "cache:product"]);
  }
  inject("../src/server/warehouse/accounting", { warehouseMove: async () => ({ repeated: false, eventId: "event", movement: { id: "movement", productId: "product" }, product, material: { name: "QA material" } }) });
  Object.assign(tx, { $transaction: async (operation: (db: typeof tx) => Promise<unknown>) => operation(tx) });
  inject("../src/server/warehouse/revalidate", { revalidateWarehouse: async () => effect("cache:warehouse") });
  const movement = fresh<typeof import("../src/server/warehouse/movement-service")>("../src/server/warehouse/movement-service");
  for (const failure of ["dispatch", "org", "cache:warehouse"]) {
    reset(); fault = failure;
    const result = await movement.createStockMovementCore({ id: "manager", name: "QA", roles: ["MANAGER"], source: "web" }, "EXPENSE", { clientMutationId: randomUUID(), productId: "product", materialId: "material", quantity: "1" });
    assert.equal(result.ok, true); assert.equal("movementId" in result ? result.movementId : undefined, "movement");
    assert.deepEqual(calls, ["dispatch", "org", "cache:warehouse"]);
  }
});
test("actual nested cache helpers retain all later paths and one lookup after early/middle/lookup faults", async () => {
  reset(); let lookups = 0, lookupFault = false, missing = false;
  Object.assign(tx, { product: { findUnique: async () => { lookups++; if (lookupFault) throw Error("private lookup failure"); return missing ? null : { number: "P", projectId: "project" }; } } });
  const load = <T,>(name: string): T => { const file = require.resolve(name); if (!originals.has(file)) originals.set(file, require.cache[file]); delete require.cache[file]; return require(name) as T; };
  const product = load<typeof import("../src/server/products/revalidate")>("../src/server/products/revalidate");
  const warehouse = load<typeof import("../src/server/warehouse/revalidate")>("../src/server/warehouse/revalidate");
  for (const failure of ["cache:/products", "cache:/products/P", "cache:/projects/project"]) {
    reset(); lookups = 0; fault = failure;
    await product.revalidateProductPaths("product");
    assert.deepEqual(calls, ["cache:/products", "cache:/products/P", "cache:/projects/project"]); assert.equal(lookups, 1);
  }
  for (const failure of ["cache:/warehouse", "cache:/warehouse/items", "cache:/finance/projects/project"]) {
    reset(); lookups = 0; fault = failure; await warehouse.revalidateWarehouse("product", "project");
    assert.equal(calls.length, 11); assert.equal(calls.at(-1), "cache:/projects/project"); assert.equal(lookups, 1);
  }
  reset(); lookups = 0; lookupFault = true;
  await warehouse.revalidateWarehouse("product", "project"); assert.equal(calls.length, 9); assert.equal(lookups, 1);
  assert.ok(!calls.includes("cache:/products/P"));
  reset(); lookups = 0; lookupFault = false; missing = true;
  await product.revalidateProductPaths("product"); assert.deepEqual(calls, ["cache:/products"]); assert.equal(lookups, 1);
  reset(); lookups = 0; await product.revalidateProductPaths(null); await warehouse.revalidateWarehouse();
  assert.equal(lookups, 0); assert.equal(calls.length, 6);
});


test("required payment UUID rejects old/forged ingress before receipts, money and effects", async () => {
  reset(); receiptReads = ["error"];
  for (const id of [undefined, "bad"]) {
    const result = await payment(actor, {...input(), clientMutationId: id} as never);
    assert.equal(result.ok, false); assert.equal(result.outcome, "ROLLED_BACK");
  }
  assert.deepEqual(receiptReads, ["error"]); assert.deepEqual({rows, logs, events, calls}, {rows:[], logs:[], events:[], calls:[]});
  const data = {...input(), clientMutationId: "00000134-0000-4000-8000-000000000210"}; receiptReads = [];
  const oldAccount = tx.cashAccount.findUnique;
  const first = await payment(actor, data); assert.equal(first.ok, true);
  tx.cashAccount.findUnique = async () => {throw Error("Currency preparation outage");};
  try {const replay = await payment(actor, {...data, clientMutationId: data.clientMutationId.toUpperCase()}); assert.equal(replay.ok, true); assert.equal(replay.resultId, first.resultId); assert.equal(rows.length,1);}
  finally {tx.cashAccount.findUnique = oldAccount;}
});

test("ten serialized actual payment commands and deleted receipt preserve one original ID", async () => {
  reset(); let tail = Promise.resolve();
  alternateTransaction = async operation => {const before = tail; let release!:()=>void; tail=new Promise<void>(done=>{release=done;}); await before; try{return await operation(tx);}finally{release();}};
  const data = {...input(), clientMutationId:"00000134-0000-4000-8000-000000000211"};
  const results = await Promise.all(Array.from({length:10},()=>payment(actor,data)));
  assert.ok(results.every(row=>row.ok&&row.resultId===results[0].resultId)); assert.equal(rows.length,1); assert.equal(logs.length,2); assert.equal(events.length,1);
  rows[0].deletionId="owned-removal";
  const removed = await payment(actor,data) as Awaited<ReturnType<typeof import("../src/server/payments/core").createPaymentCore>>;
  assert.equal(removed.ok,false); if(!removed.ok){assert.equal(removed.kind,"removed");assert.equal(removed.removedPaymentId,results[0].resultId);assert.equal(removed.clientMutationId,data.clientMutationId);}
  assert.equal(rows.length,1);assert.equal(events.length,1);
  const independent = await Promise.all(["00000134-0000-4000-8000-000000000212", "00000134-0000-4000-8000-000000000213"].map(clientMutationId=>payment(actor,{...data,clientMutationId})));
  assert.ok(independent.every(result=>result.ok)); assert.equal(new Set(independent.map(result=>result.ok&&result.resultId)).size,2);
  assert.equal(rows.length,3);assert.equal(events.length,3);
});

test("actual web actor getter/precondition denies stale account before core and bot rejects missing UUID", async () => {
  reset();
  inject("../src/server/require-role",{requireFinance:async()=>({user:actor})});
  const {getPaymentActorId,addPayment}=require("../src/server/payments/actions") as typeof import("../src/server/payments/actions");
  assert.deepEqual(await getPaymentActorId(),{ok:true,actorId:actor.id});
  const stale=await addPayment(input(),"other-account");assert.equal(stale.ok,false);if(!stale.ok)assert.equal(stale.kind,"actor-changed");assert.equal(rows.length+logs.length+events.length,0);
  for(const clientMutationId of [undefined,"bad"]){const rejected=await addPayment({...input(),clientMutationId} as never,actor.id);assert.equal(rejected.ok,false);if(!rejected.ok)assert.equal(rejected.kind,"invalid-request");}
  const {addPaidStockReceipt}=require("../src/server/warehouse/stock-purchase-actions") as typeof import("../src/server/warehouse/stock-purchase-actions");
  const stock=await addPaidStockReceipt({clientMutationId:"00000134-0000-4000-8000-000000000214",materialId:"material",quantity:"1",unitPrice:"1",currency:"BYN",cashAccountId:"cash",expenseArticleId:"article"},"other-account");
  assert.equal(stock.ok,false);if(!stock.ok)assert.equal("kind"in stock?stock.kind:undefined,"actor-changed");assert.equal(rows.length+logs.length+events.length,0);
  const apiAuth=require("../src/server/api/auth") as typeof import("../src/server/api/auth"), previousAuthenticate=apiAuth.authenticate;
  apiAuth.authenticate=async()=>({}) as never;
  try {
    const {POST}=require("../src/app/api/v1/bot/payments/route") as typeof import("../src/app/api/v1/bot/payments/route");
    const reply=await POST(new Request("http://qa.invalid/api/v1/bot/payments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...input(),clientMutationId:undefined})}));
    assert.equal((await reply.json()).ok,false);assert.equal(rows.length+logs.length+events.length,0);
  } finally {apiAuth.authenticate=previousAuthenticate;}
});
