import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Prisma} from '@prisma/client';
import {patchProductContactInTransaction} from '../src/server/projects/contact-core';
import {updateClientInTransaction,type ClientBaseline} from '../src/server/clients/core';
const manager={id:'m',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
const initial:ClientBaseline={name:'Client',phone:'100',lastName:null,middleName:null,email:null,address:'client address',comment:null};
function fixture(){
 const state={projects:[{id:'project',clientId:'client',address:null as string|null}],clients:[{id:'client',...initial},{id:'other',...initial,phone:'999'}],audit:[] as unknown[],events:[] as unknown[],locks:[] as string[],fail:false};
 const matches=(row:Record<string,unknown>,where:Record<string,unknown>)=>Object.entries(where).every(([key,value])=>row[key]===value);
 const tx={
  $queryRaw:async(strings:TemplateStringsArray)=>{state.locks.push(strings.join('?'));return[]},
  product:{findUnique:async({where}:{where:{id:string}})=>['p1','p2'].includes(where.id)?{projectId:'project'}:null},
  project:{findUnique:async()=>state.projects[0],updateMany:async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{const row=state.projects.find(row=>matches(row,where));if(!row)return{count:0};Object.assign(row,data);return{count:1}}},
  client:{findUnique:async({where}:{where:{id:string}})=>state.clients.find(row=>row.id===where.id)??null,updateMany:async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{const row=state.clients.find(row=>matches(row,where));if(!row)return{count:0};Object.assign(row,data);return{count:1}}},
  changeLog:{create:async({data}:{data:unknown})=>{state.audit.push(data);return data}},
  domainEvent:{create:async({data}:{data:unknown})=>{if(state.fail)throw new Error('Injected outbox failure');state.events.push(data);return data}},
 } as unknown as Prisma.TransactionClient;
 const run=async<T>(callback:()=>Promise<T>)=>{const before=structuredClone(state);try{return await callback()}catch(error){Object.assign(state,before);throw error}};
 return{state,tx,run};
}
test('two products share project address and client phone with no duplicated product values',async()=>{
 const f=fixture();const address=await patchProductContactInTransaction(manager,{productId:'p1',field:'address',value:'  shared address  ',expectedValue:null},f.tx);
 assert.equal(address.ok,true);assert.equal(f.state.projects[0].address,'shared address');
 const conflict=await patchProductContactInTransaction(manager,{productId:'p2',field:'address',value:'Other',expectedValue:null},f.tx);assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.currentValue,'shared address');
 const phone=await patchProductContactInTransaction(manager,{productId:'p2',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(phone.ok,true);assert.equal(f.state.clients[0].phone,'200');assert.equal(f.state.audit.length,2);assert.equal(f.state.events.length,2);
 assert.match(f.state.locks[0],/Project/);assert.match(f.state.locks.at(-1)??'',/Client/);
});
test('client switch races against old phone without modifying either client phone',async()=>{
 const f=fixture();const switched=await patchProductContactInTransaction(manager,{productId:'p1',field:'clientId',value:'other',expectedValue:'client'},f.tx);assert.equal(switched.ok,true);
 const phone=await patchProductContactInTransaction(manager,{productId:'p2',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(phone.ok,false);if(!phone.ok){assert.equal(phone.kind,'conflict');assert.equal(phone.currentClientId,'other');assert.equal(phone.currentValue,'999');assert.equal(phone.currentClientLabel,'Client')}
 assert.deepEqual(f.state.clients.map(row=>row.phone),['100','999']);assert.equal(f.state.audit.length,1);
});
test('phone no-op and same-field conflict, legacy empty repair and blank rejection',async()=>{
 const f=fixture();const base={productId:'p1',field:'phone' as const,expectedValue:'100',expectedClientId:'client'};
 const noop=await patchProductContactInTransaction(manager,{...base,value:'100'},f.tx);assert.equal(noop.ok&&noop.changed,false);assert.equal(f.state.audit.length,0);
 await patchProductContactInTransaction(manager,{...base,value:'200'},f.tx);
 const conflict=await patchProductContactInTransaction(manager,{...base,value:'300'},f.tx);assert.equal(conflict.ok,false);assert.equal(f.state.clients[0].phone,'200');
 const blank=await patchProductContactInTransaction(manager,{...base,expectedValue:'200',value:'   '},f.tx);assert.equal(blank.ok,false);
 f.state.clients[0].phone='';assert.equal((await patchProductContactInTransaction(manager,{...base,expectedValue:'',value:'400'},f.tx)).ok,true);
});
test('standalone client CAS changes only submitted field and rejects stale same-field writes',async()=>{
 const f=fixture();const first=await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,phone:initial.phone,address:initial.address??undefined,lastName:undefined,middleName:undefined,email:'one@example.test',comment:undefined},initial);assert.equal(first.ok,true);
 const second=await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,address:initial.address??undefined,lastName:undefined,middleName:undefined,email:undefined,comment:undefined,phone:'200'},initial);assert.equal(second.ok,true);assert.equal(f.state.clients[0].email,'one@example.test');assert.equal(f.state.clients[0].phone,'200');
 const stale=await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,address:initial.address??undefined,lastName:undefined,middleName:undefined,email:undefined,comment:undefined,phone:'300'},initial);assert.equal(stale.ok,false);assert.equal(f.state.clients[0].phone,'200');
});
test('outbox failure rolls back contacts and audit as one transaction',async()=>{
 const f=fixture();f.state.fail=true;
 await assert.rejects(f.run(()=>patchProductContactInTransaction(manager,{productId:'p1',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx)),/outbox failure/);
 assert.equal(f.state.clients[0].phone,'100');assert.equal(f.state.audit.length,0);assert.equal(f.state.events.length,0);
});
test('read-only office/field roles cannot see contact conflict values; union manager retains writes',async()=>{
 const f=fixture();for(const roles of [['ENGINEER'],['ACCOUNTANT'],['WORKER'],['MOUNTER'],['ENGINEER','ACCOUNTANT']] as const){
 const result=await patchProductContactInTransaction({...manager,roles:[...roles]},{productId:'p1',field:'address',value:'x',expectedValue:'hidden'},f.tx);assert.equal(result.ok,false);if(!result.ok){assert.equal(result.kind,'forbidden');assert.equal(result.currentValue,undefined)}
 }
 const result=await patchProductContactInTransaction({...manager,roles:['MANAGER','ENGINEER']},{productId:'p1',field:'address',value:'x',expectedValue:null},f.tx);assert.equal(result.ok,true);
});

test('forbidden role cannot disclose the newly bound client phone or label',async()=>{
 const f=fixture();f.state.projects[0].clientId='other';
 const result=await patchProductContactInTransaction({...manager,roles:['ENGINEER','ACCOUNTANT']},{productId:'p1',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(result.ok,false);if(!result.ok){assert.equal(result.kind,'forbidden');assert.equal(result.currentValue,undefined);assert.equal(result.currentClientLabel,undefined);assert.equal(result.currentClientId,undefined)}
 assert.equal(f.state.locks.length,0);assert.deepEqual(f.state.clients.map(row=>row.phone),['100','999']);assert.equal(f.state.audit.length,0);assert.equal(f.state.events.length,0);
});
