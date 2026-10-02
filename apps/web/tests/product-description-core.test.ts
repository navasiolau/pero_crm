import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { patchProductCore, updateProductCore, createProductCore } from "../src/server/products/core";
import { type ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
const actor = { id: "m", name: "M", roles: ["MANAGER" as const], source: "web" as const };
function fixture() {
  let product = { id: "p", projectId: "j", title: "Old", kind: null, quantity: 1, expectedPrice: "10.00", initialPrice: null, engineerId: "e", description: "Tech", status: "DESIGN" };
  const logs: Record<string, unknown>[] = []; const events: unknown[] = []; let failAudit = false;
  const tx = { $queryRaw: async () => [],
    product: { findMany: async()=>[], create:async({data}:{data:Record<string,unknown>})=>({id:'created',...data}), findFirst: async () => product, findUnique: async () => product,
      update: async ({ data }: { data: object }) => Object.assign(product, data) },
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

const exact="  A\n\tB\n\nC  \n\n";
const descriptionPatch=(value:string|null,expectedValue:string|null):ProductPatch=>({productId:'p',field:'description',value,expectedValue,clientMutationId:randomUUID()});
test('create and inline description preserve every raw nonblank character including CRLF',async()=>{
 for(const text of [exact,'  A\r\n\tB\r\n\r\n', '<script>alert(1)</script>\n**literal**  \n']){
 const f=fixture();const created=await createProductCore(actor,{projectId:'j',title:'New',description:text},f.transaction);assert.equal(created.ok,true);if(created.ok)assert.equal(created.product.description,text);
 const saved=await patchProductCore(actor,descriptionPatch(text,'Tech'),f.transaction);assert.equal(saved.kind,'saved');if(saved.kind==='saved')assert.equal(saved.value,text);assert.equal(f.product().description,text);
 }
});
test('raw unchanged legacy whitespace patch and full update never normalize or audit',async()=>{
 const f=fixture();f.product().description=' \t\r\n ';
 const result=await patchProductCore(actor,descriptionPatch(f.product().description,f.product().description),f.transaction);assert.equal(result.kind,'saved');if(result.kind==='saved')assert.equal(result.noOp,true);assert.equal(f.logs.length,0);assert.equal(f.product().description,' \t\r\n ');
 const legacy=await updateProductCore(actor,'p',{description:' \t\r\n '},{description:' \t\r\n '},f.transaction);assert.equal(legacy.ok,true);assert.equal(f.logs.length,0);
});
test('changed whitespace-only input becomes null in inline and legacy while raw baseline remains exact',async()=>{
 const f=fixture();const saved=await patchProductCore(actor,descriptionPatch(' \t\r\n ','Tech'),f.transaction);assert.equal(saved.kind,'saved');assert.equal(f.product().description,null);
 const g=fixture();const legacy=await updateProductCore(actor,'p',{description:' \t\r\n '},{description:'Tech'},g.transaction);assert.equal(legacy.ok,true);assert.equal(g.product().description,null);
});
test('whitespace-different stale baseline conflicts and audit failure restores exact raw row',async()=>{
 const f=fixture();f.product().description=exact;
 const stale=await patchProductCore(actor,descriptionPatch('new',exact.trim()),f.transaction);assert.equal(stale.kind,'conflict');if(stale.kind==='conflict')assert.equal(stale.currentValue,exact);assert.equal(f.product().description,exact);
 f.failAudit();assert.equal((await patchProductCore(actor,descriptionPatch('new  \n',exact),f.transaction)).kind,'failure');assert.equal(f.product().description,exact);
});
