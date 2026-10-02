import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { DomainActor } from "../src/server/projects/core";
import { configureEngineeringPool, createEngineeringWorkCore, convertUnpaidWorkToEngineering,
  closeEngineeringStageCore } from "../src/server/product-stage-pay/core";
import { engineeringIntegrationFixture } from "./helpers/product-engineering-integration-fixture";

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
