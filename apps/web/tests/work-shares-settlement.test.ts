import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { splitTaskCore } from "../src/server/tasks/share-core";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { taskShareFixture, historicalTaskAllocation } from "./helpers/task-share-fixture";
import { remainingWorkQuantity } from "../src/lib/work-quantity";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

let fixture = taskShareFixture();
let sessionActor = { id: "manager", name: "Manager", roles: ["MANAGER"] };
let externalEffects = 0;
const revalidated: string[] = [];
let actions: typeof import("../src/server/tasks/actions");
let shares: typeof import("../src/server/tasks/share-actions");
let queries: typeof import("../src/server/tasks/queries");
let scope: ReturnType<typeof guardedModuleCache>;
function prepareScope() {
  sessionActor = { id: "manager", name: "Manager", roles: ["MANAGER"] };
  externalEffects = 0; revalidated.length = 0;
  fixture = taskShareFixture();
  const emptyParticipants = { findMany: async () => [] };
  const transactionWithParticipants: typeof fixture.transaction = operation => fixture.transaction(tx => operation(new Proxy(tx, { get: (target, key, receiver) => key === "productPercentageParticipant" ? emptyParticipants : Reflect.get(target, key, receiver) })));
  const proxy = new Proxy({}, { get: (_target, key) => key === "$transaction" ? transactionWithParticipants : key === "productPercentageParticipant" ? emptyParticipants : fixture.database[key as keyof typeof fixture.database] });
  const outsideTransaction = async () => { externalEffects++; assert.equal(fixture.inTransaction(), false, "External effect ran before commit"); };
  const overrides = {
    "../src/auth": { auth: async () => ({ user: sessionActor }) },
    "next/cache": { revalidatePath: (path: string) => { revalidated.push(path); } },
    "../src/server/products/revalidate": { revalidateProductPaths: async (id: string | null) => { revalidated.push(`product:${id}`); } },
    "../src/server/plugins/changelog": { writeChangeLog: outsideTransaction },
    "../src/server/plugins/events": { emitDomainEvent: outsideTransaction, dispatchEvent: outsideTransaction },
    "../src/server/notifications/notify": { notifyOrg: outsideTransaction, notifyPerson: outsideTransaction },
    "../src/server/payroll/queries": { getPayrollCurrency: async () => "BYN" },
  };
  scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/tasks/actions", "../src/server/tasks/share-actions", "../src/server/tasks/queries"], allowedOverrides: Object.keys(overrides), overrides, prisma: proxy as PrismaClient });
  actions = scope.load("../src/server/tasks/actions"); shares = scope.load("../src/server/tasks/share-actions");
  queries = scope.load("../src/server/tasks/queries");
}
beforeEach(prepareScope);
afterEach(() => scope?.restore());



test("completion pays only the fixed remaining split budget", async () => {
  fixture = taskShareFixture();
  const split = historicalTaskAllocation(fixture);
  assert.ok(split.ok);
  assert.equal((await actions.changeTaskStatus("source", "DONE", 20)).ok, true);
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
  assert.equal((await actions.changeTaskStatus("source", "DONE", 20)).ok, true);
  assert.equal(fixture.state().entries.length, 0);
});

test("old TASK_FIXED installation allocation stays readable but split form and action refuse it", async () => {
  fixture = taskShareFixture();
  fixture.state().works[0].paymentKind = "INSTALLATION";
  const source = fixture.state().tasks[0];
  source.allocationGroupId = "old-group"; source.shareUnits = 1000000; source.shareAmount = "1000.00";
  fixture.state().groups.push({ id: "old-group", workId: "work", quantity: "10", budget: "1000.00",
    currency: "BYN", budgetSource: "TASK_FIXED" });
  const before = structuredClone(fixture.state());
  const options = await shares.getTaskSplitOptions("source");
  assert.equal(options.ok, false);
  const result = await splitTaskCore({ id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" },
    { taskId: "source", recipientId: "recipient", percent: "50", expectedRevision: 0, requestId: randomUUID() }, fixture.transaction);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /больше недоступны/);
  assert.deepEqual(fixture.state(), before);
  assert.deepEqual(fixture.writes, []);
});

test("simultaneous completion requests cannot create duplicate earnings", async () => {
  fixture = taskShareFixture();
  await Promise.all([actions.changeTaskStatus("source", "DONE", 20), actions.changeTaskStatus("source", "DONE", 20)]);
  assert.equal(fixture.state().entries.length, 1);
});

test("payroll write failure rolls back status and time with the allocation unchanged", async () => {
  fixture = taskShareFixture(); fixture.failOn("payroll.create");
  const before = structuredClone(fixture.state());
  await assert.rejects(actions.changeTaskStatus("source", "DONE", 20), /Injected/);
  assert.deepEqual(fixture.state(), before);
});

test("split and completion serialize without paying the original budget twice", async () => {
  for (const splitFirst of [true, false]) {
    fixture = taskShareFixture();
    const split = () => splitTaskCore({ id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" }, { taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, requestId: randomUUID() }, fixture.transaction);
    const complete = () => changeTaskStatusCore({ id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" }, "source", "DONE", 20, fixture.transaction);
    const results = await Promise.all(splitFirst ? [split(), complete()] : [complete(), split()]);
    assert.equal(fixture.state().entries.length, 1);
    assert.equal(Number(fixture.state().entries[0].amount), 1000);
    assert.equal(fixture.state().groups.length, 0);
    assert.equal(results[splitFirst ? 0 : 1].ok, false);
  }
});

test("dependent cannot finish after original part alone; both parts earn their exact shares", async () => {
  fixture = taskShareFixture();
  const result = historicalTaskAllocation(fixture);
  assert.ok(result.ok);
  assert.equal((await actions.changeTaskStatus("source", "DONE", 20)).ok, true);
  assert.equal((await actions.changeTaskStatus("dependent", "IN_PROGRESS")).ok, false);
  fixture.state().files.push({ id: "new-photo", taskId: result.childTaskId, projectId: "project", productId: "product" });
  fixture.state().currency = "USD";
  assert.equal((await actions.changeTaskStatus(result.childTaskId, "DONE", 30)).ok, true);
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
  const create = await actions.createTask({ clientMutationId: randomUUID(), expectedActorId: sessionActor.id, projectId: "project", productId: "product", workId: "work", title: "remaining", type: "Прочее", dueAt: "2026-10-01", assigneeId: "recipient", quantity: 5, estimateMinutes: 30 });
  assert.equal(create.ok, true);
  assert.equal((await actions.createTask({ clientMutationId: randomUUID(), expectedActorId: sessionActor.id, projectId: "project", productId: "product", workId: "work", title: "overflow", type: "Прочее", dueAt: "2026-10-01", assigneeId: "director", quantity: 1, estimateMinutes: 10 })).ok, false);
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

test("retired split action refuses while historical DTO remains read-only", async () => {
  fixture = taskShareFixture(); historicalTaskAllocation(fixture);
  assert.equal((await shares.getTaskSplitOptions("source")).ok, false);
  assert.equal((await shares.splitTask({taskId:"source",recipientId:"recipient",percent:"30",expectedRevision:1,requestId:randomUUID()})).ok,false);
  const { mapTaskDetails } = queries;
  const row=await fixture.database.task.findFirst({where:{id:"source"}});
  const [mapped]=await mapTaskDetails([row as never],{id:"worker",roles:["WORKER"]});
  assert.equal(mapped.personalQuantity,"7"); assert.equal(mapped.shareAmount,"700.00");
  assert.equal(mapped.shareCurrency,"BYN"); assert.equal(mapped.canSplit,false);
});

test("UI fractional remainder reaches strict create and edit actions without binary tails", async () => {
  fixture = taskShareFixture();
  fixture.state().works[0].quantity = "10.30";
  const remaining = remainingWorkQuantity("10.30", "10.00");
  const created = await actions.createTask({ clientMutationId: randomUUID(), expectedActorId: sessionActor.id, projectId: "project", productId: "product", workId: "work", title: "fractional remainder", type: "Прочее", dueAt: "2026-10-01", assigneeId: "recipient", quantity: Number(remaining), estimateMinutes: 10 });
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
 const ordinary={projectId:'project',productId:'product',workId:'work',title:'portion',type:'Прочее',dueAt:'2026-10-01',assigneeId:'recipient',estimateMinutes:10};
 assert.equal((await actions.createTask({...ordinary,clientMutationId:randomUUID(),expectedActorId:sessionActor.id,quantity:4})).ok,true);
 assert.equal((await actions.createTask({...ordinary,clientMutationId:randomUUID(),expectedActorId:sessionActor.id,title:'second',quantity:6})).ok,true);
 assert.equal((await actions.createTask({...ordinary,clientMutationId:randomUUID(),expectedActorId:sessionActor.id,quantity:1})).ok,false);
 const rows=fixture.state().tasks.filter(row=>row.workId==='work');
 assert.deepEqual(rows.map(row=>String(row.executorShare)),['1','1']);
 assert.ok(rows.every(row=>row.allocationGroupId===null&&row.shareUnits===null&&row.shareAmount===null));
});
test('stale create and update share payloads fail before writes, including fullshare1',async()=>{
 const ordinary={projectId:'project',title:'portion',type:'Прочее',dueAt:'2026-10-01',estimateMinutes:10};
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
 assert.equal((await actions.changeTaskStatus('source','DONE',20)).ok,true);
 assert.equal((await actions.changeTaskStatus('historic-child','DONE',20)).ok,true);
 assert.equal((await actions.changeTaskStatus('source','DONE',20)).ok,true);
 assert.deepEqual(fixture.state().entries.map(row=>Number(row.amount)).sort((a,b)=>a-b),[40,60]);
 assert.ok(fixture.state().entries.every(row=>row.currency==='BYN'));
 assert.equal(fixture.state().groups.length,1);
});

test("исторический split replay сохраняет revalidation без уведомлений, событий и новых записей", async () => {
  fixture = taskShareFixture(); historicalTaskAllocation(fixture);
  const input = { taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, requestId: randomUUID() };
  fixture.state().logs.push({ id: `task-split:${input.requestId}`, actorId: "manager", entityId: "source", action: "split",
    newValue: { recipientId: "recipient", percent: "30.00", expectedRevision: 0, childTaskId: "historic-child", groupId: "historic-group" } });
  const before = structuredClone(fixture.state());
  externalEffects = 0; revalidated.length = 0;
  try {
    assert.deepEqual(await shares.splitTask(input), { ok: true, childTaskId: "historic-child" });
    assert.deepEqual(revalidated, ["/my", "/tasks", "/projects/project", "product:product"]);
    revalidated.length = 0;
    for (const change of [{ percent: "50" }, { recipientId: "accountant" }, { expectedRevision: 1 }, { requestId: randomUUID() }]) {
      assert.equal((await shares.splitTask({ ...input, ...change })).ok, false);
    }
    sessionActor = { id: "worker", name: "Worker", roles: ["WORKER"] };
    assert.equal((await shares.splitTask(input)).ok, false);
    assert.deepEqual(revalidated, []);
    assert.equal(externalEffects, 0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.state(), before);
  } finally {
    sessionActor = { id: "manager", name: "Manager", roles: ["MANAGER"] };
  }
});

// ESM namespace живёт дольше require.cache; stale owner обязан отказать.
test("fixture ESM mapper rejects a closed owner while the current real mapper works", async () => {
  const stale = await import("../src/server/tasks/queries");
  const row = await fixture.database.task.findFirst({ where: { id: "source" } });
  scope.restore(); prepareScope();
  await assert.rejects(stale.mapTaskDetails([row as never], { id: "manager", roles: ["MANAGER"] }), /FIXTURE_SCOPE_CLOSED/);
  assert.equal((await queries.mapTaskDetails([row as never], { id: "manager", roles: ["MANAGER"] })).length, 1);
});
