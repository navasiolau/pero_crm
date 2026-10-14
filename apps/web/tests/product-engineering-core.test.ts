import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type Prisma } from "@prisma/client";
import { type DomainActor } from "../src/server/projects/core";
import { configureEngineeringPool, configureEngineeringTaskShares, createEngineeringWorkCore, closeEngineeringStageCore, prepareEngineeringQuote, convertUnpaidWorkToEngineering } from "../src/server/product-stage-pay/core";
import { deliverEngineeringClosed, deliverEngineeringCreated } from "../src/server/product-stage-pay/post-commit";
import { engineeringIntegrationFixture } from "./helpers/product-engineering-integration-fixture";
import { taskPaymentLabel, workPaymentAmountLabel, workPaymentSourceLabel } from "../src/lib/task-payment-display";
import { previewStageSplit } from "../src/lib/product-stage-split-preview";
import { getEngineeringFundView } from "../src/server/products/engineering-view";
import { percentToStageUnits } from "../src/lib/engineering-fund-view";

{ // Источник: product-engineering-core.test.ts
const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };
const noDb = new Proxy({}, { get: () => { throw new Error("unauthorized operation touched database"); } }) as Prisma.TransactionClient;

test("repeat close receipt requires the same entity and action", async () => {
  const f = engineeringIntegrationFixture();
  f.db.changeLog.findUnique = (async () => ({ actorId: manager.id, entityId: "product", action: "unrelated", newValue: {
    expectedPoolRevision: 0, settlementId: "old" } })) as never;
  await assert.rejects(closeEngineeringStageCore(manager, { productId: "product", expectedPoolRevision: 0, requestId: randomUUID() }, null, f.db), /использован/);
});

test("repeat close returns the original settlement after product advances, without requiring FX", async () => {
  const f = engineeringIntegrationFixture();
  f.state().product.status = "DONE";
  f.db.changeLog.findUnique = (async () => ({ actorId: manager.id, entity: "product", entityId: "product", action: "engineering.close",
    newValue: { expectedPoolRevision: 0, settlementId: "old" } })) as never;
  const result = await closeEngineeringStageCore(manager, { productId: "product", expectedPoolRevision: 0, requestId: randomUUID() }, null, f.db);
  assert.deepEqual(result, { settlementId: "old", repeated: true, eventId: null, eventIds: [], earnings: [], product: null });
  assert.deepEqual(f.writes, []);
});

test("post-commit delivery tolerates failed notifications and emits nothing on replay", async () => {
  const calls: string[] = [];
  const effects = {
    dispatchEvent: async (id: string) => { calls.push(`dispatch:${id}`); throw new Error("offline"); },
    notifyPerson: async (input: { type: string }) => { calls.push(`person:${input.type}`); throw new Error("offline"); },
    notifyOrg: async (input: { type: string }) => { calls.push(`org:${input.type}`); throw new Error("offline"); },
  };
  await deliverEngineeringCreated({ eventIds: ["task-created", "task-assigned"], assigneeId: "u", taskTitle: "Design", projectNumber: "205" }, effects);
  await deliverEngineeringClosed({ repeated: false, eventIds: ["payroll", "status", "settled"], product: { number: "205.1", title: "Desk" },
    earnings: [{ userId: "u", name: "User", amount: "5.00", currency: "BYN" }] }, manager.id, effects);
  assert.deepEqual(calls, ["dispatch:task-created", "dispatch:task-assigned", "person:task.assigned", "dispatch:payroll", "dispatch:status",
    "dispatch:settled", "org:product.statusChanged", "person:payroll.accrued", "org:payroll.orgAccrued"]);
  calls.length = 0;
  await deliverEngineeringClosed({ repeated: true, eventIds: [], product: null, earnings: [] }, manager.id, effects);
  assert.deepEqual(calls, []);
});

test("new fund configuration/taskshare/work creation deny all roles before any data access",async()=>{
 for(const roles of [["ADMIN"],["DIRECTOR"],["MANAGER"],["ENGINEER"],["WORKER"]] as DomainActor["roles"][]){
 const actor={...manager,roles};
 await assert.rejects(configureEngineeringPool(actor,{productId:"p",ratePercent:"5",workWeights:[],expectedPoolRevision:0},noDb));
 await assert.rejects(configureEngineeringTaskShares(actor,{productId:"p",workId:"w",shares:[],expectedPoolRevision:0},noDb));
 await assert.rejects(createEngineeringWorkCore(actor,{productId:"p",title:"work",quantity:"1",assigneeId:"u",dueAt:new Date(),estimateMinutes:1,poolWeights:[],expectedPoolRevision:0},noDb));
 }
});
test("new close with stale/valid quote preserves all historical facts withoutwrites",async()=>{
 const f=engineeringIntegrationFixture();const quote=await prepareEngineeringQuote("product",f.db);
 await assert.rejects(closeEngineeringStageCore(manager,{productId:"product",expectedPoolRevision:0,requestId:randomUUID()},quote,f.db),/запрещено/);
 assert.deepEqual(f.writes,[]);
});
}

// Источник: product-engineering-display.test.ts
test("canonical unavailable reward never falls back to engineering preview or frozen compatibility fields", () => {
  for (const rewardAmount of [null, undefined]) {
    assert.equal(taskPaymentLabel({workId:"work",paymentKind:"ENGINEERING",rewardAmount,rewardCurrency:"BYN",rewardSource:"UNAVAILABLE",shareAmount:"999",shareCurrency:"USD",previewAmount:"150",previewCurrency:"BYN",settledSource:true}),"—");
  }
});
test("canonical frozen reward including zero remains exact and ignores unrelated preview", () => {
  for (const rewardAmount of ["0.00", "17.89"]) {
    assert.equal(taskPaymentLabel({workId:"work",paymentKind:"ENGINEERING",rewardAmount,rewardCurrency:"BYN",rewardSource:"FROZEN_TASK_SNAPSHOT",previewAmount:"999",previewCurrency:"USD",shareAmount:"888",shareCurrency:"USD"}), taskPaymentLabel({workId:"work",rewardAmount,rewardCurrency:"BYN",rewardSource:"FROZEN_TASK_SNAPSHOT"}));
  }
});
test("unknown FX and legacy preview reason are not a Task reward projection", () => {
  assert.equal(taskPaymentLabel({workId:"work",paymentKind:"ENGINEERING",rewardAmount:null,rewardCurrency:null,rewardSource:"UNAVAILABLE",previewAmount:null,previewReason:"Курс недоступен",shareAmount:"999",shareCurrency:"BYN"}),"—");
});
test("task money comes only from server reward DTO, with no unfunded-task label", () => {
  assert.match(taskPaymentLabel({ workId: "work", rewardAmount: "70", rewardCurrency: "BYN", rewardSource: "WORK_SNAPSHOT", shareAmount: "999", shareCurrency: "USD" }), /70.*BYN/);
  assert.equal(taskPaymentLabel({ workId: null }), "—");
});
test("task without server monetary projection does not invent an installation reward", () => {
  assert.equal(taskPaymentLabel({ workId: "install-work", paymentKind: "INSTALLATION", shareAmount: "999", shareCurrency: "USD" }), "—");
});
test("installation work source does not show a separate work or task budget", () => {
  const work = { paymentKind: "INSTALLATION" as const, priceSnapshot: "999.00", total: "999.00", quantity: "4" };
  assert.equal(workPaymentSourceLabel(work), "Монтаж — процент от изделия");
  assert.equal(workPaymentAmountLabel(work), "Источник оплаты: процентный этап изделия");
  assert.doesNotMatch(workPaymentSourceLabel(work) + workPaymentAmountLabel(work), /999|BYN|×/);
});

test("zero assigned-work reward remains real BYN money and stale share fields cannot override it", () => {
 const value = taskPaymentLabel({workId:"w",rewardAmount:"0.00",rewardCurrency:"BYN",rewardSource:"WORK_SNAPSHOT",shareAmount:"999",shareCurrency:"USD"});
 assert.match(value,/0.*BYN/);assert.doesNotMatch(value,/999|USD|дол|процент|Без денежного/i);
 assert.equal(taskPaymentLabel({workId:"w",shareAmount:"999",shareCurrency:"BYN"}),"—");
});

// Источник: product-engineering-split-preview.test.ts
const at = "2026-09-01T00:00:00.000Z";

test("50 percent of a 300 BYN engineering work shows 150/150 and independent physical/pay shares", () => {
  const result = previewStageSplit("a", 1_000_000, 1_000_000, "50", { workAmount: "300.00", currency: "BYN", tasks: [{ id: "a", stageShareUnits: 1_000_000, createdAt: at }] });
  assert.equal(result.remainingAmount, "150.00"); assert.equal(result.transferredAmount, "150.00");
  assert.equal(result.remainingUnits, 500_000); assert.equal(result.transferredStageUnits, 500_000);
});
test("two-cent preview recomputes the whole work instead of dividing the old rounded cent", () => {
  const result = previewStageSplit("a", 1_000_000, 333_300, "50", { workAmount: "0.02", currency: "BYN", tasks: [
    { id: "a", stageShareUnits: 333_300, createdAt: at }, { id: "b", stageShareUnits: 333_300, createdAt: at }, { id: "c", stageShareUnits: 333_400, createdAt: at },
  ] });
  assert.equal(result.remainingAmount, "0.00"); assert.equal(result.transferredAmount, "0.00");
  assert.equal(result.remainingStageUnits, 166_650);
});
test("absent FX does not prevent splitting units or pretend money is zero", () => {
  const result = previewStageSplit("a", 1_000_000, 800_000, "50", null);
  assert.equal(result.remainingUnits, 500_000); assert.equal(result.remainingStageUnits, 400_000);
  assert.equal(result.remainingAmount, null); assert.equal(result.transferredAmount, null);
});
test("zero financial share remains zero while physical work can be divided", () => {
  const result = previewStageSplit("a", 1_000_000, 0, "50", { workAmount: "100", currency: "BYN", tasks: [
    { id: "a", stageShareUnits: 0, createdAt: at }, { id: "b", stageShareUnits: 1_000_000, createdAt: at },
  ] });
  assert.equal(result.transferredStageUnits, 0); assert.equal(result.transferredUnits, 500_000); assert.equal(result.transferredAmount, "0.00");
});
test("stale stage-vector and a positive share too small to transfer are rejected", () => {
  assert.throws(() => previewStageSplit("a", 1_000_000, 500_000, "50", { workAmount: "10", currency: "BYN", tasks: [{ id: "a", stageShareUnits: 1_000_000, createdAt: at }] }), /измен|дол/i);
  assert.throws(() => previewStageSplit("a", 1_000_000, 1, "50", null), /мал/i);
});

// Источник: product-engineering-view.test.ts
test("settled fund shows saved names, weights and physical quantities instead of later mutable records", async () => {
  const task = { id: "task", workId: "work", productId: "product", projectId: "project", title: "Новое название задачи", status: "DONE", assigneeId: "user", assignee: { name: "Новое имя" }, quantity: "10", executorShare: "1", allocationGroupId: null, shareUnits: null, stageShareUnits: 1_000_000, splitRevision: 9 };
  const work = { id: "work", title: "Новое название работы", projectId: "project", paymentKind: "ENGINEERING", stagePayPoolId: "pool", quantity: "10", poolWeightUnits: 1_000_000, tasks: [task] };
  const settlement = { priceSnapshot: "10000", ratePercentSnapshot: "5", amount: "500", payrollCurrency: "BYN", productCurrency: "BYN", closedAt: new Date("2026-09-01"), shares: [{ taskId: "task", workId: "work", taskTitleSnapshot: "Задача при начислении", workTitleSnapshot: "Работа при начислении", userNameSnapshot: "Имя при начислении", stageShareUnits: 500_000, workWeightUnits: 600_000, quantitySnapshot: "5", quantityShareUnitsSnapshot: 500_000, amount: "150", bynAmount: "150", projectAmount: "150" }] };
  const product = { id: "product", projectId: "project", status: "PRODUCTION", engineerId: "user", expectedPrice: "12000", project: { currency: "BYN" }, works: [work], stagePayPools: [{ id: "pool", state: "SETTLED", revision: 4, ratePercent: "5", settlement, works: [work] }] };
  const db = { product: { findUnique: async () => product } } as unknown as Parameters<typeof getEngineeringFundView>[0];
  const result = await getEngineeringFundView(db, "product", false);
  assert.equal(result.priceBasis, "10000"); assert.equal(result.ratePercent, "5"); assert.equal(result.amount, "500");
  assert.equal(result.works[0].title, "Работа при начислении"); assert.equal(result.works[0].weightUnits, 600_000);
  assert.equal(result.works[0].tasks[0].title, "Задача при начислении"); assert.equal(result.works[0].tasks[0].assigneeName, "Имя при начислении");
  assert.equal(result.works[0].tasks[0].quantity, "2.5"); assert.equal(result.works[0].tasks[0].units, 500_000);
  assert.equal(result.canClose, false);
});

test("percentage input preserves zero and minimum share precision without binary arithmetic", () => {
  assert.equal(percentToStageUnits("0"), 0); assert.equal(percentToStageUnits("0,0001"), 1);
  assert.equal(percentToStageUnits("33.3333"), 333_333); assert.equal(percentToStageUnits("100"), 1_000_000);
  for (const value of ["", "1e2", "0.00001", "100.01", "-1"]) assert.throws(() => percentToStageUnits(value));
});

{ // Источник: product-engineering-integration.test.ts
const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };

function legacyTwoTaskFixture() {
  const f = engineeringIntegrationFixture();
  const now = new Date("2026-09-01T00:00:00Z");
  f.state().works.push({ id: "legacy", projectId: "project", productId: "product", paymentKind: "LEGACY", stagePayPoolId: null,
    poolWeightUnits: null, title: "Работа", quantity: "5.00", priceSnapshot: "10.00", total: "50.00", createdAt: now });
  f.state().groups.push({ id: "old-group", workId: "legacy", quantity: "2.00", budget: "20.00", currency: "BYN", budgetSource: "TASK_FIXED" });
  f.state().tasks.push({ id: "task-a", workId: "legacy", projectId: "project", productId: "product", title: "A", status: "DONE",
    assigneeId: "primary", quantity: "2.00", shareUnits: 1_000_000, shareAmount: "20.00", stageShareUnits: null,
    allocationGroupId: "old-group", splitRevision: 0, executorShare: "1", doneAt: now, createdAt: now });
  f.state().tasks.push({ id: "task-b", workId: "legacy", projectId: "project", productId: "product", title: "B", status: "DONE",
    assigneeId: "second", quantity: "3.00", shareUnits: null, shareAmount: null, stageShareUnits: null,
    allocationGroupId: null, splitRevision: 0, executorShare: "1", doneAt: now, createdAt: new Date("2026-09-02T00:00:00Z") });
  f.state().times.push({ id: "time", taskId: "task-a", minutes: 45 });
  f.state().files.push({ id: "file", taskId: "task-b", fileName: "drawing.pdf" });
  f.state().dependencies.push({ id: "dependency", taskId: "task-b", dependsOnId: "task-a" });
  return f;
}

test("retired fund writers leave existing work/task/group/time/file/dependency snapshots unchanged",async()=>{
 const f=legacyTwoTaskFixture();const before=structuredClone(f.state());
 await assert.rejects(f.transaction(tx=>configureEngineeringPool(manager,{productId:"product",ratePercent:"5",workWeights:[],expectedPoolRevision:0},tx)));
 await assert.rejects(f.transaction(tx=>createEngineeringWorkCore(manager,{productId:"product",title:"new",quantity:"1",assigneeId:"primary",dueAt:new Date(),estimateMinutes:10,poolWeights:[],expectedPoolRevision:0},tx)));
 await assert.rejects(f.transaction(tx=>convertUnpaidWorkToEngineering(manager,{workId:"legacy",poolId:"pool",poolWeights:[],taskShares:[],expectedPoolRevision:0,requestId:randomUUID()},tx)),/закрыта/);
 await assert.rejects(f.transaction(tx=>closeEngineeringStageCore(manager,{productId:"product",expectedPoolRevision:0,requestId:randomUUID()},null,tx)),/запрещено/);
 assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
});
}
