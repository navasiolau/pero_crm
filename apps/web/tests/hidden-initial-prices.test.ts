import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { patchProductCore, updateProductCore, createProductCore } from "../src/server/products/core";
import { createSchema, updateSchema } from "../src/server/products/core";
import { createProjectSchema } from "../src/server/projects/core";
import { legacyProjectUpdateSchema } from "../src/server/projects/project-field-core";
import { productPatchSchema } from "../src/server/products/patch-contract";
import { projectPatchSchema } from "../src/server/projects/patch-contract";
import { readFileSync } from "node:fs";
import { type ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
const actor = { id: "m", name: "M", roles: ["MANAGER" as const], source: "web" as const };
function fixture(eligible = true, initialPrice: string | null = null) {
  let product = { id: "p", projectId: "j", title: "Old", kind: null, quantity: 1, expectedPrice: null as string | number | null, initialPrice, initialPriceCaptureEligible: eligible, engineerId: "e", description: "Tech", status: "DESIGN" };
  const logs: Record<string, unknown>[] = []; const events: unknown[] = []; let failAudit = false;
  const tx = { $queryRaw: async () => [],
    product: { findMany: async()=>[], create:async({data}:{data:Record<string,unknown>})=>({id:'created',...data}), findFirst: async () => product, findUnique: async () => product,
      update: async ({ data }: { data: object }) => Object.assign(product, Object.fromEntries(Object.entries(data).map(([key,value])=>[key,typeof value === "object" && value !== null && "toFixed" in value ? String(value) : value]))) },
    project: { findUnique: async () => ({ id: "j", number: "1", currency: "BYN", clientId: "new" }) },
    client: { findUnique: async () => ({ id: "new", name: "New Client", phone: "999", lastName: null, middleName: null }) },
    user: { findFirst: async () => ({ id: "e", name: "Engineer" }), findUnique: async () => ({ id: "e", name: "Engineer", roles: ["ENGINEER"], active: true }) },
    task: { findMany: async () => [] },
    work: { findMany: async () => [] }, projectMaterial: { findMany: async () => [] },
    productStagePayPool: { updateMany: async () => ({ count: 0 }) },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => logs.find(row => row.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { if (failAudit) throw new Error("audit failure"); logs.push(data); return data; } },
    domainEvent: { create: async ({ data }: { data: unknown }) => { events.push(data); return { id: "event" }; } },
  } as unknown as Prisma.TransactionClient;
  let tail = Promise.resolve();
  const transaction: TaskTransaction = async (fn) => { const previous = tail; let release!: () => void; tail = new Promise(r => { release=r; }); await previous;
    const before = structuredClone(product); const oldLogs=logs.length, oldEvents=events.length;
    try { return await fn(tx); } catch(error) { product=before; logs.length=oldLogs; events.length=oldEvents; throw error; } finally { release(); }
  };
  return { tx, transaction, product: () => product, logs, events, failAudit: () => { failAudit=true; } };
}

const pricePatch=(value:string|null,expectedValue:string|null):ProductPatch=>({productId:"p",field:"expectedPrice",value,expectedValue,clientMutationId:randomUUID()});
test("new create captures zero and unit price; absent price keeps durable eligibility",async()=>{
 for(const expectedPrice of [undefined,0,123.45]) {
  const f=fixture();const result=await createProductCore(actor,{projectId:"j",title:"New",quantity:3,...(expectedPrice===undefined?{}:{expectedPrice})},f.transaction);
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.product.initialPrice?.toString()??null,expectedPrice===undefined?null:String(expectedPrice));
  assert.equal(result.product.initialPriceCaptureEligible,expectedPrice===undefined);
 }
});
test("inline first zero captures once; replay, later price, null and quantity preserve snapshot",async()=>{
 const f=fixture();const input=pricePatch("0",null);
 assert.equal((await patchProductCore(actor,input,f.transaction)).kind,"saved");
 assert.equal(String(f.product().initialPrice),"0");assert.equal(f.product().initialPriceCaptureEligible,false);
 const logs=f.logs.length;assert.equal((await patchProductCore(actor,input,f.transaction)).kind,"saved");assert.equal(f.logs.length,logs);
 assert.equal((await patchProductCore(actor,pricePatch("200","0.00"),f.transaction)).kind,"saved");
 assert.equal((await patchProductCore(actor,pricePatch(null,"200.00"),f.transaction)).kind,"saved");
 assert.equal((await updateProductCore(actor,"p",{quantity:3},{quantity:1},f.transaction)).ok,true);
 assert.equal(String(f.product().initialPrice),"0");
});
test("full CAS captures first price; stale write and audit failure roll back capture",async()=>{
 const f=fixture();assert.equal((await updateProductCore(actor,"p",{expectedPrice:12.34},{expectedPrice:null},f.transaction)).ok,true);
 assert.equal(String(f.product().initialPrice),"12.34");
 const g=fixture();assert.equal((await updateProductCore(actor,"p",{expectedPrice:9},{expectedPrice:"1"},g.transaction)).ok,false);assert.equal(g.product().initialPrice,null);
 g.failAudit();assert.equal((await patchProductCore(actor,pricePatch("9",null),g.transaction)).kind,"failure");
 assert.equal(g.product().expectedPrice,null);assert.equal(g.product().initialPrice,null);assert.equal(g.product().initialPriceCaptureEligible,true);assert.equal(g.logs.length,0);
});
test("legacy NULL and existing snapshot never capture",async()=>{
 for(const [eligible,initial] of [[false,null],[true,"15.00"]] as const){const f=fixture(eligible,initial);assert.equal((await patchProductCore(actor,pricePatch("50",null),f.transaction)).kind,"saved");assert.equal(f.product().initialPrice,initial);}
});
test("missing price and unrelated edits keep eligibility; two competing first prices capture only one",async()=>{
 const f=fixture();assert.equal((await updateProductCore(actor,"p",{title:"New"},{title:"Old"},f.transaction)).ok,true);
 assert.equal((await patchProductCore(actor,pricePatch(null,null),f.transaction)).kind,"saved");
 assert.equal(f.product().initialPrice,null);assert.equal(f.product().initialPriceCaptureEligible,true);
 const results=await Promise.all([patchProductCore(actor,pricePatch("10",null),f.transaction),patchProductCore(actor,pricePatch("20",null),f.transaction)]);
 assert.equal(results.filter(result=>result.kind==="saved").length,1);assert.equal(results.filter(result=>result.kind==="conflict").length,1);
 assert.equal(String(f.product().initialPrice),"10");assert.equal(f.logs.filter(row=>row.action==="initialPrice.capture").length,1);
});
test("ordinary create/full/inline Product and Project DTOs reject initialPrice instead of stripping",()=>{
 assert.equal(createSchema.safeParse({projectId:"j",title:"New",initialPrice:0}).success,false);
 assert.equal(updateSchema.safeParse({title:"New",initialPrice:null}).success,false);
 assert.equal(createProjectSchema.safeParse({title:"New",clientId:"c",initialPrice:0}).success,false);
 assert.equal(legacyProjectUpdateSchema.safeParse({initialPrice:0,baseline:{initialPrice:null}}).success,false);
 assert.equal(legacyProjectUpdateSchema.safeParse({title:"New",baseline:{title:"Old",initialPrice:null}}).success,false);
 assert.equal(productPatchSchema.safeParse({...pricePatch("1",null),initialPrice:0}).success,false);
 assert.equal(productPatchSchema.safeParse({...pricePatch("1",null),field:"initialPrice"}).success,false);
 assert.equal(projectPatchSchema.safeParse({projectId:"j",field:"initialPrice",value:"1",expectedValue:null,clientMutationId:randomUUID()}).success,false);
});
test("migration disables old rows; Project create never derives an initial product sum",()=>{
 const migration=readFileSync(new URL("../prisma/migrations/20261002150000_hidden_initial_prices/migration.sql",import.meta.url),"utf8");
 assert.match(migration,/BOOLEAN NOT NULL DEFAULT false/);assert.doesNotMatch(migration,/UPDATE|SUM|expectedPrice/);
 const project=readFileSync(new URL("../src/server/projects/core.ts",import.meta.url),"utf8");assert.match(project,/initialPrice: null/);assert.doesNotMatch(project,/initialPrice: data\.initialPrice|SUM\([^)]*initialPrice/);
});
