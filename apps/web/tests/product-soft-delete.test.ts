import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {deleteProductCore} from '../src/server/products/core';
import type {TaskTransaction} from '../src/server/tasks/transaction';
const actor={id:'m',name:'M',roles:['MANAGER'] as ['MANAGER'],source:'web' as const},uuid='12222222-2222-4222-8222-222222222222';
function fixture(){
 const product={id:'p',projectId:'j',number:'1.1',title:'History',updatedAt:new Date('2026-10-03T10:00:00Z'),deletedAt:null as Date|null,deletedById:null as string|null,_count:{tasks:1,works:1,projectMaterials:1,stockMovements:1}},project={id:'j',deletedAt:null as Date|null};
 const history={files:[{id:'f'}],tasks:[{id:'t'}],works:[{id:'w'}],completion:[{id:'immutable',amount:'100.00'}],payroll:[{id:'pay',amount:'100.00'}]},logs=new Map<string,Record<string,unknown>>();let timer=0;
 const tx={$queryRaw:async()=>[],product:{findUnique:async()=>product,updateMany:async({where,data}:{where:{updatedAt:Date;deletedAt:null};data:{deletedAt:Date;deletedById:string}})=>{if(product.deletedAt||+product.updatedAt!==+where.updatedAt)return{count:0};Object.assign(product,data);return{count:1}},delete:async()=>{throw Error('PHYSICAL_DELETE_FORBIDDEN')}},project:{findUnique:async()=>project},timeEntry:{count:async()=>timer},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.get(where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.set(data.id as string,data);return data}}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=async callback=>{const before=structuredClone(product),old=new Map(logs);try{return await callback(tx)}catch(e){Object.assign(product,before);logs.clear();old.forEach((v,k)=>logs.set(k,v));throw e;}};
 return{product,project,history,logs,tx,transaction,setTimer:(n:number)=>{timer=n;}};
}
test('logical deletion accepts historical dependencies and preserves every record and number',async()=>{
 const f=fixture(),before=structuredClone(f.history);
 const result=await deleteProductCore(actor,'p',f.transaction,{expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid});
 assert.equal(result.ok,true);assert.ok(f.product.deletedAt);assert.equal(f.product.deletedById,'m');assert.equal(f.product.number,'1.1');assert.deepEqual(f.history,before);
});
test('active timer, stale baseline and deleted parent refuse without any changes',async()=>{
 for(const scenario of ['timer','stale','parent']){const f=fixture(),baseline={expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid};if(scenario==='timer')f.setTimer(1);if(scenario==='stale')baseline.expectedUpdatedAt='2026-10-03T09:00:00.000Z';if(scenario==='parent')f.project.deletedAt=new Date();const before=structuredClone({product:f.product,history:f.history});const result=await deleteProductCore(actor,'p',f.transaction,baseline);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,scenario==='timer'?'active-timer':scenario==='stale'?'conflict':'not-found');assert.deepEqual({product:f.product,history:f.history},before);assert.equal(f.logs.size,0);}
});
test('manager union is allowed, pure engineer and finance/warehouse roles denied',async()=>{
 for(const roles of [['ENGINEER'],['ACCOUNTANT'],['PROCUREMENT']] as const){const f=fixture(),result=await deleteProductCore({...actor,roles:[...roles]},'p',f.transaction,{expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'forbidden');assert.equal(f.product.deletedAt,null);}
 const f=fixture();assert.equal((await deleteProductCore({...actor,roles:['MANAGER','ENGINEER']},'p',f.transaction,{expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid})).ok,true);
});
test('same UUID exact replay is one audit, changed payload conflicts; parent deletion denies even replay',async()=>{
 const f=fixture(),baseline={expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid};assert.equal((await deleteProductCore(actor,'p',f.transaction,baseline)).ok,true);const repeat=await deleteProductCore(actor,'p',f.transaction,baseline);assert.equal(repeat.ok,true);if(repeat.ok)assert.equal(repeat.repeated,true);assert.equal(f.logs.size,1);assert.equal((await deleteProductCore(actor,'p',f.transaction,{...baseline,expectedUpdatedAt:'2026-10-03T09:00:00.000Z'})).ok,false);f.project.deletedAt=new Date();assert.equal((await deleteProductCore(actor,'p',f.transaction,baseline)).ok,false);assert.equal(f.logs.size,1);
});
test('legacy missing baseline fails closed, audit failure rolls tombstone back',async()=>{
 const f=fixture();assert.equal((await deleteProductCore(actor,'p',f.transaction)).ok,false);f.tx.changeLog.create=(async()=>{throw Error('AUDIT_FAILURE')}) as unknown as typeof f.tx.changeLog.create;const result=await deleteProductCore(actor,'p',f.transaction,{expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid});assert.equal(result.ok,false);assert.equal(f.product.deletedAt,null);assert.equal(f.product.deletedById,null);assert.equal(f.logs.size,0);
});
