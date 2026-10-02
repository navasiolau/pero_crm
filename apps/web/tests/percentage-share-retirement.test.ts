import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
import type { DomainActor } from '../src/server/projects/core';
const require=createRequire(import.meta.url);
const {configureProductPercentageCore,transferProductPercentageCore}=require(process.env.SHARE_CORE_BASELINE??'../src/server/product-percentage-pay/core') as typeof import('../src/server/product-percentage-pay/core');
function fixture(){
 const writes:string[]=[];const participants=[{userId:'a',shareUnits:400000},{userId:'b',shareUnits:600000}];
 const tx={product:{findUnique:async()=>({id:'p',projectId:'project',engineerId:'a'})},productPercentageCompletion:{findUnique:async()=>null},
 productPercentageConfig:{findUnique:async()=>({id:'cfg',kind:'ENGINEERING',ratePercent:'5',revision:2,reviewedLegacyWorkIds:[],participants}),update:async()=>{writes.push('config');return {id:'cfg',revision:3}}},
 productPercentageParticipant:{deleteMany:async()=>{writes.push('delete')},createMany:async()=>{writes.push('participants')}},
 user:{findMany:async()=>[{id:'a'},{id:'b'}],findFirst:async()=>({id:'b'})},changeLog:{create:async()=>{writes.push('audit')}}} as unknown as Prisma.TransactionClient;
 return{tx,writes,participants};
}
const manager:DomainActor={id:'manager',name:'Manager',roles:['MANAGER'],source:'web'};
const input={productId:'p',kind:'ENGINEERING' as const,ratePercent:'6',expectedRevision:2};
test('rate-only configure preserves exact participant records without deletion/recreation',async()=>{
 const f=fixture();const before=structuredClone(f.participants);
 assert.deepEqual(await configureProductPercentageCore(manager,input,f.tx),{revision:3});assert.deepEqual(f.writes,['config','audit']);assert.deepEqual(f.participants,before);
});
test('configuration rejects sameusers changedshares, replaceduser, and stale revision before writes',async()=>{
 for(const patch of [{participants:[{userId:'a',shareUnits:500000},{userId:'b',shareUnits:500000}]},{participants:[{userId:'a',shareUnits:400000},{userId:'c',shareUnits:600000}]},{expectedRevision:1}]){
 const f=fixture();await assert.rejects(configureProductPercentageCore(manager,{...input,...patch},f.tx));assert.deepEqual(f.writes,[]);
 }
});
test('exact reordered legacy participant payload can edit rate without reallocation',async()=>{
 const f=fixture();await configureProductPercentageCore(manager,{...input,participants:[...f.participants].reverse()},f.tx);assert.deepEqual(f.writes,['config','audit']);
});
test('transfer cannot create or redistribute shares for any actor',async()=>{
 for(const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['ENGINEER'],['MOUNTER'],['WORKER'],['ACCOUNTANT'],['MANAGER','ENGINEER']] as DomainActor['roles'][]){
 const f=fixture();await assert.rejects(transferProductPercentageCore({...manager,id:'a',roles},{productId:'p',kind:'ENGINEERING',toUserId:'b',percentOfOwnShare:'10',expectedRevision:2},f.tx));assert.deepEqual(f.writes,[]);
 }
});
