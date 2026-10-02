import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
import type { DomainActor } from '../src/server/projects/core';
import { randomUUID } from 'node:crypto';
import { patchProductPercentageCore } from '../src/server/product-percentage-pay/patch-core';
const require=createRequire(import.meta.url);
const {configureProductPercentageCore,transferProductPercentageCore}=require(process.env.SHARE_CORE_BASELINE??'../src/server/product-percentage-pay/core') as typeof import('../src/server/product-percentage-pay/core');
function fixture(){
 const writes:string[]=[];const participants=[{userId:'a',shareUnits:400000},{userId:'b',shareUnits:600000}];
 const tx={product:{findUnique:async()=>({id:'p',projectId:'project',engineerId:'a'})},productPercentageCompletion:{findUnique:async()=>null},
 productPercentageConfig:{findUnique:async()=>({id:'cfg',kind:'ENGINEERING',ratePercent:'5',revision:2,reviewedLegacyWorkIds:[],participants}),update:async()=>{writes.push('config');return {id:'cfg',revision:3}}},
 productPercentageParticipant:{deleteMany:async()=>{writes.push('delete')},createMany:async()=>{writes.push('participants')}},
 user:{findMany:async()=>[{id:'a'},{id:'b'}],findFirst:async()=>({id:'b'})},changeLog:{findUnique:async()=>null,create:async()=>{writes.push('audit')}}} as unknown as Prisma.TransactionClient;
 return{tx,writes,participants};
}
const manager:DomainActor={id:'manager',name:'Manager',roles:['MANAGER'],source:'web'};
const input={productId:'p',kind:'ENGINEERING' as const,ratePercent:'6',expectedRevision:2};
test('typed rate-only patch preserves exact historical participant records without deletion/recreation',async()=>{
 const f=fixture();const before=structuredClone(f.participants);
 const result=await patchProductPercentageCore(manager,{productId:'p',kind:'ENGINEERING',field:'ratePercent',value:'6',expectedValue:'5',expectedRevision:2,clientMutationId:randomUUID()},f.tx);
 assert.equal(result.ok,true);if(result.ok)assert.equal(result.revision,3);assert.deepEqual(f.writes,['config','audit']);assert.deepEqual(f.participants,before);
});
test('configuration rejects sameusers changedshares, replaceduser, and stale revision before writes',async()=>{
 for(const patch of [{participants:[{userId:'a',shareUnits:500000},{userId:'b',shareUnits:500000}]},{participants:[{userId:'a',shareUnits:400000},{userId:'c',shareUnits:600000}]},{expectedRevision:1}]){
 const f=fixture();await assert.rejects(configureProductPercentageCore(manager,{...input,...patch},f.tx));assert.deepEqual(f.writes,[]);
 }
});
test('even exact reordered legacy configure payload is retired without changing rate or participants',async()=>{
 const f=fixture();const before=structuredClone(f.participants);
 await assert.rejects(configureProductPercentageCore(manager,{...input,participants:[...f.participants].reverse()},f.tx),/одиночное поле/);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.participants,before);
});

test('typed rate patch rejects stale revision without historical participant writes',async()=>{
 const f=fixture();const before=structuredClone(f.participants);
 const result=await patchProductPercentageCore(manager,{productId:'p',kind:'ENGINEERING',field:'ratePercent',value:'6',expectedValue:'5',expectedRevision:1,clientMutationId:randomUUID()},f.tx);
 assert.equal(result.kind,'conflict');assert.deepEqual(f.writes,[]);assert.deepEqual(f.participants,before);
});
test('transfer cannot create or redistribute shares for any actor',async()=>{
 for(const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['ENGINEER'],['MOUNTER'],['WORKER'],['ACCOUNTANT'],['MANAGER','ENGINEER']] as DomainActor['roles'][]){
 const f=fixture();await assert.rejects(transferProductPercentageCore({...manager,id:'a',roles},{productId:'p',kind:'ENGINEERING',toUserId:'b',percentOfOwnShare:'10',expectedRevision:2},f.tx));assert.deepEqual(f.writes,[]);
 }
});
