import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../src/server/projects/core";
import { configureEngineeringPool, configureEngineeringTaskShares, createEngineeringWorkCore, closeEngineeringStageCore, prepareEngineeringQuote } from "../src/server/product-stage-pay/core";
import { deliverEngineeringClosed, deliverEngineeringCreated } from "../src/server/product-stage-pay/post-commit";

const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };
const noDb = new Proxy({}, { get: () => { throw new Error("unauthorized operation touched database"); } }) as Prisma.TransactionClient;

function fixture() {
  const writes: string[] = [];
  const task = { id: "t", workId: "w", projectId: "j", productId: "p", status: "DONE", assigneeId: "u", assignee: { id: "u", name: "User" },
    stageShareUnits: 1_000_000, splitRevision: 0, quantity: { toString: () => "1.00" }, shareUnits: 1_000_000, allocationGroupId: "g",
    allocationGroup: { id: "g", workId: "w", quantity: { toString: () => "1.00" } }, createdAt: new Date("2026-01-01"), title: "Task" };
  const work = { id: "w", projectId: "j", productId: "p", paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000,
    createdAt: new Date("2026-01-01"), title: "Work", tasks: [task] };
  const pool = { id: "pool", kind: "ENGINEERING", state: "DRAFT", revision: 0, ratePercent: { toString: () => "5.00" },
    legacyPayrollEntryIds: [], works: [work] };
  const product = { id: "p", number: "205.1", title: "Desk", projectId: "j", status: "DESIGN", expectedPrice: { toString: () => "100.00" }, engineerId: "u",
    engineer: { id: "u", name: "User" }, project: { id: "j", number: "205", currency: "BYN" }, works: [work], stagePayPools: [pool] };
  const db = { product: { findUnique: async () => product }, orgSetting: { findUnique: async () => null },
    work: { update: async () => { writes.push("work"); } },
    productStagePayPool: { update: async () => { writes.push("pool"); return pool; } },
    productStageSettlement: { count: async () => 0, create: async () => ({ id: "s" }) },
    productStageSettlementShare: { create: async () => ({ id: "ss" }) },
    payrollEntry: { count: async () => 0, create: async () => ({ id: "e" }) },
    productStatusHistory: { create: async () => ({ id: "h" }) },
    domainEvent: { create: async () => ({ id: "event" }) },
    changeLog: { findUnique: async () => null, create: async () => ({ id: "receipt" }) } } as unknown as Prisma.TransactionClient;
  return { db, product, pool, work, task, writes };
}

test("repeat close receipt requires the same entity and action", async () => {
  const f = fixture();
  f.db.changeLog.findUnique = (async () => ({ actorId: manager.id, entityId: "p", action: "unrelated", newValue: {
    expectedPoolRevision: 0, settlementId: "old" } })) as never;
  await assert.rejects(closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, null, f.db), /использован/);
});

test("repeat close returns the original settlement after product advances, without requiring FX", async () => {
  const f = fixture();
  f.product.status = "DONE";
  f.db.changeLog.findUnique = (async () => ({ actorId: manager.id, entity: "product", entityId: "p", action: "engineering.close",
    newValue: { expectedPoolRevision: 0, settlementId: "old" } })) as never;
  const result = await closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, null, f.db);
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
 const f=fixture();const quote=await prepareEngineeringQuote("p",f.db);
 await assert.rejects(closeEngineeringStageCore(manager,{productId:"p",expectedPoolRevision:0,requestId:randomUUID()},quote,f.db),/запрещено/);
 assert.deepEqual(f.writes,[]);
});
