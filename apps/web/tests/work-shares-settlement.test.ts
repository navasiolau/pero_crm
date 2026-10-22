import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { taskShareFixture, historicalTaskAllocation } from "./helpers/task-share-fixture";
import { remainingWorkQuantity } from "../src/lib/work-quantity";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import { recordTaskCreateReceipt } from "../src/server/tasks/creation-receipts";

let fixture = taskShareFixture();
let sessionActor = { id: "manager", name: "Manager", roles: ["MANAGER"] };
const revalidated: string[] = [];
let actions: typeof import("../src/server/tasks/actions");
let queries: typeof import("../src/server/tasks/queries");
let scope: ReturnType<typeof guardedModuleCache>;
function prepareScope() {
  sessionActor = { id: "manager", name: "Manager", roles: ["MANAGER"] };
  revalidated.length = 0;
  fixture = taskShareFixture();
  const emptyParticipants = { findMany: async () => [] };
  const transactionWithParticipants: typeof fixture.transaction = operation => fixture.transaction(tx => operation(new Proxy(tx, { get: (target, key, receiver) => key === "productPercentageParticipant" ? emptyParticipants : Reflect.get(target, key, receiver) })));
  const proxy = new Proxy({}, { get: (_target, key) => key === "$transaction" ? transactionWithParticipants : key === "productPercentageParticipant" ? emptyParticipants : fixture.database[key as keyof typeof fixture.database] });
  const outsideTransaction = async () => { assert.equal(fixture.inTransaction(), false, "External effect ran before commit"); };
  const overrides = {
    "../src/auth": { auth: async () => ({ user: sessionActor }) },
    "next/cache": { revalidatePath: (path: string) => { revalidated.push(path); } },
    "../src/server/products/revalidate": { revalidateProductPaths: async (id: string | null) => { revalidated.push(`product:${id}`); } },
    "../src/server/plugins/changelog": { writeChangeLog: outsideTransaction },
    "../src/server/plugins/events": { emitDomainEvent: outsideTransaction, dispatchEvent: outsideTransaction },
    "../src/server/notifications/notify": { notifyOrg: outsideTransaction, notifyPerson: outsideTransaction },
    "../src/server/payroll/queries": { getPayrollCurrency: async () => "BYN" },
  };
  scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/tasks/actions", "../src/server/tasks/queries"], allowedOverrides: Object.keys(overrides), overrides, prisma: proxy as PrismaClient });
  actions = scope.load("../src/server/tasks/actions");
  queries = scope.load("../src/server/tasks/queries");
}
beforeEach(prepareScope);
afterEach(() => scope?.restore());

test("completion pays only the fixed remaining split budget", async () => {
  fixture = taskShareFixture();
  const split = historicalTaskAllocation(fixture);
  assert.ok(split.ok);
  assert.equal((await actions.changeTaskStatus("source", "DONE")).ok, true);
  assert.equal(fixture.state().entries.length, 1);
  assert.equal(Number(fixture.state().entries[0].amount), 700);
});

test("classified installation splits only physical quantity and never pays task PIECE", async () => {
  fixture = taskShareFixture();
  fixture.state().works[0].paymentKind = "INSTALLATION";
  const split = historicalTaskAllocation(fixture, true);
  assert.equal(split.ok, true);
  assert.equal(fixture.state().groups[0].budgetSource, "PHYSICAL_ONLY");
  assert.equal(fixture.state().groups[0].budget, null);
  assert.equal(fixture.state().groups[0].currency, null);
  const parts = fixture.state().tasks.filter((task) => task.allocationGroupId);
  assert.deepEqual(parts.map((task) => task.shareUnits).sort(), [300000, 700000]);
  assert.ok(parts.every((task) => task.physicalOnlyShare === true && task.shareAmount === null && task.stageShareUnits == null));
  assert.equal((await actions.changeTaskStatus("source", "DONE")).ok, true);
  assert.equal(fixture.state().entries.length, 0);
});

test("simultaneous completion requests cannot create duplicate earnings", async () => {
  fixture = taskShareFixture();
  await Promise.all([actions.changeTaskStatus("source", "DONE"), actions.changeTaskStatus("source", "DONE")]);
  assert.equal(fixture.state().entries.length, 1);
});

test("payroll write failure rolls back status and time with the allocation unchanged", async () => {
  fixture = taskShareFixture(); fixture.failOn("payroll.create");
  const before = structuredClone(fixture.state());
  await assert.rejects(actions.changeTaskStatus("source", "DONE"), /Injected/);
  assert.deepEqual(fixture.state(), before);
});

test("dependent cannot finish after original part alone; both parts earn their exact shares", async () => {
  fixture = taskShareFixture();
  const result = historicalTaskAllocation(fixture);
  assert.ok(result.ok);
  assert.equal((await actions.changeTaskStatus("source", "DONE")).ok, true);
  assert.equal((await actions.changeTaskStatus("dependent", "IN_PROGRESS")).ok, false);
  fixture.state().files.push({ id: "new-photo", taskId: result.childTaskId, projectId: "project", productId: "product" });
  fixture.state().currency = "USD";
  assert.equal((await actions.changeTaskStatus(result.childTaskId, "DONE")).ok, true);
  assert.equal((await actions.changeTaskStatus("dependent", "IN_PROGRESS")).ok, true);
  assert.deepEqual(fixture.state().entries.map((entry) => Number(entry.amount)).sort(), [300, 700]);
  assert.ok(fixture.state().entries.every((entry) => entry.currency === "BYN"));
});

test("work allocation counts split group once and existing parts cannot be moved or deleted", async () => {
  fixture = taskShareFixture();
  historicalTaskAllocation(fixture);
  for (const update of [{ quantity: 1 }, { workId: null }, { productId: null }]) assert.equal((await actions.updateTask("source", update)).ok, false);
  assert.equal((await actions.deleteTask("source")).ok, false);
  fixture.state().works[0].quantity = "15";
  const create = await actions.createTask({ clientMutationId: randomUUID(), expectedActorId: sessionActor.id, projectId: "project", productId: "product", workId: "work", title: "remaining", type: "Прочее", dueAt: "2026-10-01", assigneeId: "recipient", quantity: 5 });
  assert.equal(create.ok, true);
  assert.equal((await actions.createTask({ clientMutationId: randomUUID(), expectedActorId: sessionActor.id, projectId: "project", productId: "product", workId: "work", title: "overflow", type: "Прочее", dueAt: "2026-10-01", assigneeId: "director", quantity: 1 })).ok, false);
});

test("selecting one part as dependency expands to the whole group; cycles roll back edits", async () => {
  fixture = taskShareFixture();
  // The dependent is a real task of an independent priced Work. It must not
  // consume quantity from the source Work whose old group is tested below.
  fixture.state().works.push({...fixture.state().works[0],id:"dependent-work",quantity:"1",total:"100"});
  Object.assign(fixture.state().tasks.find(task=>task.id==="dependent")!,{workId:"dependent-work",quantity:"1"});
  const result = historicalTaskAllocation(fixture);
  assert.ok(result.ok);
  assert.equal((await actions.updateTask("dependent", { dependencyIds: ["source"] })).ok, true);
  assert.ok(fixture.state().dependencies.some((edge) => edge.taskId === "dependent" && edge.dependsOnId === result.childTaskId));
  const before = structuredClone(fixture.state());
  assert.equal((await actions.updateTask("source", { title: "must not change", dependencyIds: [result.childTaskId] })).ok, false);
  assert.deepEqual(fixture.state(), before);
});

test("historical split DTO remains read-only", async () => {
  fixture = taskShareFixture(); historicalTaskAllocation(fixture);
  const { mapTaskDetails } = queries;
  const row=await fixture.database.task.findFirst({where:{id:"source"}});
  const [mapped]=await mapTaskDetails([row as never],{id:"worker",roles:["WORKER"]});
  assert.equal(mapped.personalQuantity,"7"); assert.equal(mapped.shareAmount,"700.00");
  assert.equal(mapped.shareCurrency,"BYN"); assert.equal(mapped.canSplit,false);
  assert.equal(mapped.canTransferPiecework,true);
  assert.equal("spentMinutes" in mapped, false); assert.equal("estimateMinutes" in mapped, false);
});

test("new estimates refuse without writes; old create UUID confirms before retired validation and history cannot cascade-delete", async () => {
  const request = { projectId: "project", productId: "product", workId: "work", assigneeId: "recipient", title: "old task", type: "Производство", dueAt: "2026-10-01", estimateMinutes: 30, clientMutationId: randomUUID(), expectedActorId: "manager" };
  const before = structuredClone(fixture.state());
  assert.equal((await actions.createTask(request)).ok, false);
  assert.equal((await actions.updateTask("source", { estimateMinutes: null })).ok, false);
  assert.equal((await actions.deleteTask("source")).ok, false);
  assert.deepEqual(fixture.state(), before);
  await fixture.transaction(tx => recordTaskCreateReceipt({ ...sessionActor, roles: ["MANAGER"], source: "web" }, request, "old-confirmed-task", tx));
  const saved = structuredClone(fixture.state());
  const result = await actions.createTask(request);
  assert.ok(result.ok && result.replayed); if (result.ok) assert.equal(result.resultId, "old-confirmed-task");
  assert.deepEqual(fixture.state(), saved);
});

test("UI fractional remainder reaches strict create and edit actions without binary tails", async () => {
  fixture = taskShareFixture();
  fixture.state().works[0].quantity = "10.30";
  const remaining = remainingWorkQuantity("10.30", "10.00");
  const created = await actions.createTask({ clientMutationId: randomUUID(), expectedActorId: sessionActor.id, projectId: "project", productId: "product", workId: "work", title: "fractional remainder", type: "Прочее", dueAt: "2026-10-01", assigneeId: "recipient", quantity: Number(remaining) });
  assert.equal(created.ok, true);
  assert.equal(fixture.state().tasks.find((task) => task.title === "fractional remainder")?.quantity, "0.30");
  fixture = taskShareFixture();
  fixture.state().works[0].quantity = "10.30";
  fixture.state().tasks[0].quantity = "0.20";
  fixture.state().tasks[2].workId = "work";
  fixture.state().tasks[2].quantity = "9.80";
  assert.equal((await actions.updateTask("source", { quantity: Number(remainingWorkQuantity("10.30", "10.00", "0.20")) })).ok, true);
  assert.equal(fixture.state().tasks[0].quantity, "0.50");
  assert.equal((await actions.updateTask("source", { quantity: 0.501 })).ok, false);
});

test("engineering DTO never presents retained legacy money as the current work price", async () => {
  fixture = taskShareFixture();
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000 });
  fixture.state().tasks[0].stageShareUnits = 1_000_000;
  const row = await fixture.database.task.findFirst({ where: { id: "source" } });
  const { mapTaskDetails } = queries;
  const [mapped] = await mapTaskDetails([row as never], { id: "manager", roles: ["MANAGER"] });
  assert.equal(mapped.paymentKind, "ENGINEERING");
  assert.equal(mapped.workPriceSnapshot, null); assert.equal(mapped.workTotal, null); assert.equal(mapped.shareAmount, null);
  assert.equal(fixture.state().works[0].priceSnapshot, "100"); assert.equal(fixture.state().works[0].total, "1000");
});
test('ordinary quantity4+6 consumes10 once, full executor pay, and rejects excess',async()=>{
 fixture=taskShareFixture(); fixture.state().tasks[0].workId=null; fixture.state().tasks[0].quantity=null;
 const ordinary={projectId:'project',productId:'product',workId:'work',title:'portion',type:'Прочее',dueAt:'2026-10-01',assigneeId:'recipient'};
 assert.equal((await actions.createTask({...ordinary,clientMutationId:randomUUID(),expectedActorId:sessionActor.id,quantity:4})).ok,true);
 assert.equal((await actions.createTask({...ordinary,clientMutationId:randomUUID(),expectedActorId:sessionActor.id,title:'second',quantity:6})).ok,true);
 assert.equal((await actions.createTask({...ordinary,clientMutationId:randomUUID(),expectedActorId:sessionActor.id,quantity:1})).ok,false);
 const rows=fixture.state().tasks.filter(row=>row.workId==='work');
 assert.deepEqual(rows.map(row=>String(row.executorShare)),['1','1']);
 assert.ok(rows.every(row=>row.allocationGroupId===null&&row.shareUnits===null&&row.shareAmount===null));
});
test('stale create and update share payloads fail before writes, including fullshare1',async()=>{
 const ordinary={projectId:'project',title:'portion',type:'Прочее',dueAt:'2026-10-01'};
 for(const extra of [{executorShare:0.4},{executorShare:1},{shareUnits:1000000},{shareAmount:'10.00'},{allocationGroupId:'old'},{stageShareUnits:1000000},{physicalOnlyShare:true},{splitRevision:2}]) {
 fixture=taskShareFixture();const before=structuredClone(fixture.state());
 assert.equal((await actions.createTask({...ordinary,...extra} as never)).ok,false);
 assert.equal((await actions.updateTask('source',{title:'changed',...extra} as never)).ok,false);
 assert.deepEqual(fixture.state(),before);assert.deepEqual(fixture.writes,[]);
 }
});
test('historical grouped assignee cannot be transferred via ordinary update',async()=>{
 fixture=taskShareFixture();historicalTaskAllocation(fixture);const before=structuredClone(fixture.state());
 assert.equal((await actions.updateTask('source',{assigneeId:'recipient'})).ok,false);
 assert.deepEqual(fixture.state(),before);assert.deepEqual(fixture.writes,[]);
});
test('two unfinished legacy allocations finish with fixed40+60 and no new groups/pay duplication',async()=>{
 fixture=taskShareFixture();historicalTaskAllocation(fixture);
 fixture.state().works[0].priceSnapshot='999';
 Object.assign(fixture.state().tasks[0],{shareUnits:400000,shareAmount:'40.00'});
 Object.assign(fixture.state().tasks.find(row=>row.id==='historic-child')!,{shareUnits:600000,shareAmount:'60.00'});
 fixture.state().groups[0].budget='100.00';
 fixture.state().files.push({id:'legacy-child-photo',taskId:'historic-child',projectId:'project',productId:'product'});
 fixture.state().currency='USD';
 assert.equal((await actions.changeTaskStatus('source','DONE')).ok,true);
 assert.equal((await actions.changeTaskStatus('historic-child','DONE')).ok,true);
 assert.equal((await actions.changeTaskStatus('source','DONE')).ok,true);
 assert.deepEqual(fixture.state().entries.map(row=>Number(row.amount)).sort((a,b)=>a-b),[40,60]);
 assert.ok(fixture.state().entries.every(row=>row.currency==='BYN'));
 assert.equal(fixture.state().groups.length,1);
});

// ESM namespace живёт дольше require.cache; stale owner обязан отказать.
test("fixture ESM mapper rejects a closed owner while the current real mapper works", async () => {
  const stale = await import("../src/server/tasks/queries");
  const row = await fixture.database.task.findFirst({ where: { id: "source" } });
  scope.restore(); prepareScope();
  await assert.rejects(stale.mapTaskDetails([row as never], { id: "manager", roles: ["MANAGER"] }), /FIXTURE_SCOPE_CLOSED/);
  assert.equal((await queries.mapTaskDetails([row as never], { id: "manager", roles: ["MANAGER"] })).length, 1);
});
