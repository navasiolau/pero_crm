import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { patchProductCore, updateProductCore } from "../src/server/products/core";
import { productPatchSchema, type ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
const actor = { id: "m", name: "M", roles: ["MANAGER" as const], source: "web" as const };
function fixture() {
  let product = { id: "p", projectId: "j", title: "Old", kind: null, quantity: 1, expectedPrice: "10.00", initialPrice: null, engineerId: "e", description: "Tech", status: "DESIGN" };
  const logs: Record<string, unknown>[] = []; const events: unknown[] = []; let failAudit = false;
  const tx = { $queryRaw: async () => [],
    product: { findFirst: async () => product, findUnique: async () => product,
      update: async ({ data }: { data: object }) => Object.assign(product, data) },
    project: { findUnique: async () => ({ id: "j", currency: "BYN", clientId: "new" }) },
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
const patch = (extra: Partial<ProductPatch> = {}): ProductPatch => ({ productId: "p", field: "title", value: "New", expectedValue: "Old", clientMutationId: randomUUID(), ...extra } as ProductPatch);

test("closed schemas reject wrong field/money/quantity and blank phone while permitting legacy expected empty phone", () => {
  assert.equal(productPatchSchema.safeParse({ ...patch(), field: "currency" }).success, false);
  assert.equal(productPatchSchema.safeParse(patch({ field: "expectedPrice", value: "-1", expectedValue: "10" })).success, false);
  assert.equal(productPatchSchema.safeParse(patch({ field: "quantity", value: 1.2, expectedValue: 1 })).success, false);
  assert.equal(productPatchSchema.safeParse({ ...patch(), field: "client.phone", value: "", expectedValue: "", expectedClientId: "c" }).success, false);
  assert.equal(productPatchSchema.safeParse({ ...patch(), field: "client.phone", value: "+375", expectedValue: "", expectedClientId: "c" }).success, true);
});
test("same-field competitors yield one saved and one conflict without silent overwrite", async () => {
  const f=fixture(); const results=await Promise.all([patchProductCore(actor,patch(),f.transaction), patchProductCore(actor,patch({value:"Other"}),f.transaction)]);
  assert.deepEqual(results.map(r=>r.kind).sort(), ["conflict","saved"]); assert.equal(f.product().title,"New");
});
test("no-op writes no audit; replay does not repeat audit and rejects changed payload", async () => {
  const f=fixture(); assert.equal((await patchProductCore(actor,patch({value:"Old"}),f.transaction)).kind,"saved"); assert.equal(f.logs.length,0);
  const input=patch(); assert.equal((await patchProductCore(actor,input,f.transaction)).kind,"saved"); const n=f.logs.length;
  const replay=await patchProductCore(actor,input,f.transaction); assert.equal(replay.kind,"saved"); assert.equal(f.logs.length,n);
  assert.equal((await patchProductCore(actor,{...input,value:"Other"} as ProductPatch,f.transaction)).kind,"validation");
});
test("money/quantity updates use Decimal strings and derive exact party sum", async () => {
  const f=fixture(); const r=await patchProductCore(actor,patch({field:"quantity",value:3,expectedValue:1}),f.transaction);
  assert.equal(r.kind,"saved"); if(r.kind==="saved") assert.equal(r.derived?.lineTotalBYN,"30.00"); assert.equal(f.product().quantity,3);
});
test("audit failure rolls data back and worker cannot reveal current field", async () => {
  const f=fixture(); f.failAudit(); assert.equal((await patchProductCore(actor,patch(),f.transaction)).kind,"failure"); assert.equal(f.product().title,"Old");
  const denied=await patchProductCore({...actor,roles:["WORKER"] as never},patch(),f.transaction); assert.equal(denied.kind,"forbidden"); assert.equal('currentValue' in denied,false);
});


test("different-field concurrent patches preserve both changes", async () => {
  const f=fixture(); const results=await Promise.all([patchProductCore(actor,patch(),f.transaction),patchProductCore(actor,patch({field:"expectedPrice",value:"0",expectedValue:"10.00"}),f.transaction)]);
  assert.ok(results.every(r=>r.kind==="saved")); assert.equal(f.product().title,"New"); assert.equal(String(f.product().expectedPrice),"0.00");
});
test("assigned engineer can edit only own DESIGN description, combined manager retains full writes", async () => {
  const f=fixture(); const engineer={...actor,id:"e",roles:["ENGINEER"] as never};
  assert.equal((await patchProductCore(engineer,patch({field:"description",value:"New tech",expectedValue:"Tech"}),f.transaction)).kind,"saved");
  assert.equal((await patchProductCore(engineer,patch(),f.transaction)).kind,"forbidden");
  f.product().status="PRODUCTION";
  const rejected=await patchProductCore(engineer,patch({field:"description",value:"Hidden",expectedValue:"New tech"}),f.transaction);
  assert.equal(rejected.kind,"forbidden"); assert.equal('currentValue' in rejected,false);
  assert.equal((await patchProductCore({...actor,roles:["MANAGER","ENGINEER"]},patch(),f.transaction)).kind,"saved");
});
test("old full-object update without genuine baseline rejects before any data or audit write", async () => {
  const f=fixture(); assert.equal((await updateProductCore(actor,"p",{title:"stale"},undefined,f.transaction)).ok,false);
  assert.equal(f.product().title,"Old"); assert.equal(f.logs.length,0);
});
test("legacy no-op with genuine baseline does not write success audit", async () => {
  const f=fixture(); assert.equal((await updateProductCore(actor,"p",{title:"Old"},{title:"Old"},f.transaction)).ok,true);
  assert.equal(f.logs.length,0);
});

test("authorized phone-binding conflict carries actual client context without writes; forbidden carries none", async () => {
  const f=fixture(); const input:ProductPatch={productId:"p",field:"client.phone",value:"draft",expectedValue:"old-phone",expectedClientId:"old",clientMutationId:randomUUID()};
  const result=await patchProductCore(actor,input,f.transaction);
  assert.equal(result.kind,"conflict"); assert.equal(result.currentClientId,"new");assert.equal(result.currentValue,"999");assert.equal(result.currentClientLabel,"New Client");
  assert.equal(f.logs.length,0);assert.equal(f.events.length,0);
  const denied=await patchProductCore({...actor,roles:["ACCOUNTANT"] as never},input,f.transaction);
  assert.equal(denied.kind,"forbidden");assert.equal('currentClientId' in denied,false);assert.equal('currentValue' in denied,false);assert.equal('currentClientLabel' in denied,false);
});


test("malformed envelopes return validation without touching a transaction", async () => {
  let calls=0;
  const transaction:TaskTransaction=async()=>{calls++;throw new Error("must not access DB");};
  for(const input of [null,undefined,"invalid",42,true,[],{}, {field:"title",value:"New",expectedValue:"Old"}]) {
    const result=await patchProductCore(actor,input as ProductPatch,transaction);
    assert.equal(result.kind,"validation");
    assert.equal('currentValue' in result,false);
  }
  assert.equal(calls,0);
});
