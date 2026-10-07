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

test('project edits the Client address shared by orders without changing Project.address',async()=>{
 const f=fixture();f.state.projects[0].address='Delivery only';
 const result=await patchProjectContactInTransaction(manager,{projectId:'project',field:'clientAddress',value:'  New client street  ',expectedValue:initial.address,expectedClientId:'client'},f.tx);
 assert.equal(result.ok,true);assert.equal(f.state.clients[0].address,'New client street');assert.equal(f.state.projects[0].address,'Delivery only');
 assert.equal(f.state.clients[0].phone,'100');assert.equal(f.state.audit.length,1);assert.equal(f.state.events.length,1);
 const conflict=await patchProjectContactInTransaction(manager,{projectId:'project',field:'clientAddress',value:'stale',expectedValue:initial.address,expectedClientId:'client'},f.tx);
 assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.currentValue,'New client street');
 const cleared=await patchProjectContactInTransaction(manager,{projectId:'project',field:'clientAddress',value:'   ',expectedValue:'New client street',expectedClientId:'client'},f.tx);
 assert.equal(cleared.ok,true);assert.equal(f.state.clients[0].address,null);
});

test('address rejects a changed client link and shares CAS with standalone Client CRUD',async()=>{
 const f=fixture();f.state.projects[0].clientId='other';
 const result=await patchProjectContactInTransaction(manager,{projectId:'project',field:'clientAddress',value:'Wrong client',expectedValue:initial.address,expectedClientId:'client'},f.tx);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'conflict');
 assert.equal(f.state.audit.length,0);assert.equal(f.state.clients[1].address,initial.address);
 f.state.projects[0].clientId='client';
 await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,phone:initial.phone,address:'From Client card'},initial);
 const stale=await patchProjectContactInTransaction(manager,{projectId:'project',field:'clientAddress',value:'Old project form',expectedValue:initial.address,expectedClientId:'client'},f.tx);
 assert.equal(stale.ok,false);assert.equal(f.state.clients[0].address,'From Client card');
});

test('address outbox failure rolls back and forbidden roles do not inspect clients',async()=>{
 const f=fixture();f.state.fail=true;
 await assert.rejects(f.run(()=>patchProjectContactInTransaction(manager,{projectId:'project',field:'clientAddress',value:'New',expectedValue:initial.address,expectedClientId:'client'},f.tx)),/outbox failure/);
 assert.equal(f.state.clients[0].address,initial.address);assert.equal(f.state.audit.length,0);
 const before=f.state.locks.length;
 for(const roles of [['ENGINEER'],['WORKER'],['MOUNTER'],['ACCOUNTANT']] as const){
 const result=await patchProjectContactInTransaction({...manager,roles:[...roles]},{projectId:'project',field:'clientAddress',value:'Secret',expectedValue:null,expectedClientId:'client'},f.tx);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'forbidden');
 }
 assert.equal(f.state.locks.length,before);
});
test('project contact CRUD retains address and phone CAS independently of product retirement',async()=>{
 const f=fixture();const address=await patchProjectContactInTransaction(manager,{projectId:'project',field:'address',value:'  shared address  ',expectedValue:null},f.tx);
 assert.equal(address.ok,true);assert.equal(f.state.projects[0].address,'shared address');
 const conflict=await patchProjectContactInTransaction(manager,{projectId:'project',field:'address',value:'Other',expectedValue:null},f.tx);assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.currentValue,'shared address');
 const phone=await patchProjectContactInTransaction(manager,{projectId:'project',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(phone.ok,true);assert.equal(f.state.clients[0].phone,'200');assert.equal(f.state.audit.length,2);assert.equal(f.state.events.length,2);
 assert.match(f.state.locks[0],/Project/);assert.match(f.state.locks.at(-1)??'',/Client/);
});
test('client switch races against old phone without modifying either client phone',async()=>{
 const f=fixture();const switched=await patchProductContactInTransaction(manager,{productId:'p1',field:'clientId',value:'other',expectedValue:'client'},f.tx);assert.equal(switched.ok,true);
 const phone=await patchProjectContactInTransaction(manager,{projectId:'project',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(phone.ok,false);if(!phone.ok){assert.equal(phone.kind,'conflict');assert.equal(phone.currentClientId,'other');assert.equal(phone.currentValue,'999');assert.equal(phone.currentClientLabel,'Client')}
 assert.deepEqual(f.state.clients.map(row=>row.phone),['100','999']);assert.equal(f.state.audit.length,1);
});
test('phone no-op and same-field conflict, legacy empty repair and blank rejection',async()=>{
 const f=fixture();const base={projectId:'project',field:'phone' as const,expectedValue:'100',expectedClientId:'client'};
 const noop=await patchProjectContactInTransaction(manager,{...base,value:'100'},f.tx);assert.equal(noop.ok&&noop.changed,false);assert.equal(f.state.audit.length,0);
 await patchProjectContactInTransaction(manager,{...base,value:'200'},f.tx);
 const conflict=await patchProjectContactInTransaction(manager,{...base,value:'300'},f.tx);assert.equal(conflict.ok,false);assert.equal(f.state.clients[0].phone,'200');
 const blank=await patchProjectContactInTransaction(manager,{...base,expectedValue:'200',value:'   '},f.tx);assert.equal(blank.ok,false);
 f.state.clients[0].phone='';assert.equal((await patchProjectContactInTransaction(manager,{...base,expectedValue:'',value:'400'},f.tx)).ok,true);
});
test('standalone client CAS changes only submitted field and rejects stale same-field writes',async()=>{
 const f=fixture();const first=await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,phone:initial.phone,address:initial.address??undefined,lastName:undefined,middleName:undefined,email:'one@example.test',comment:undefined},initial);assert.equal(first.ok,true);
 const second=await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,address:initial.address??undefined,lastName:undefined,middleName:undefined,email:undefined,comment:undefined,phone:'200'},initial);assert.equal(second.ok,true);assert.equal(f.state.clients[0].email,'one@example.test');assert.equal(f.state.clients[0].phone,'200');
 const stale=await updateClientInTransaction(f.tx,manager,'client',{name:initial.name,address:initial.address??undefined,lastName:undefined,middleName:undefined,email:undefined,comment:undefined,phone:'300'},initial);assert.equal(stale.ok,false);assert.equal(f.state.clients[0].phone,'200');
});
test('outbox failure rolls back contacts and audit as one transaction',async()=>{
 const f=fixture();f.state.fail=true;
 await assert.rejects(f.run(()=>patchProjectContactInTransaction(manager,{projectId:'project',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx)),/outbox failure/);
 assert.equal(f.state.clients[0].phone,'100');assert.equal(f.state.audit.length,0);assert.equal(f.state.events.length,0);
});
test('read-only office/field roles cannot see contact conflict values; union manager retains writes',async()=>{
 const f=fixture();for(const roles of [['ENGINEER'],['ACCOUNTANT'],['WORKER'],['MOUNTER'],['ENGINEER','ACCOUNTANT']] as const){
 const result=await patchProductContactInTransaction({...manager,roles:[...roles]},{productId:'p1',field:'address',value:'x',expectedValue:'hidden'},f.tx);assert.equal(result.ok,false);if(!result.ok){assert.equal(result.kind,'forbidden');assert.equal(result.currentValue,undefined)}
 }
 const result=await patchProductContactInTransaction({...manager,roles:['MANAGER','ENGINEER']},{productId:'p1',field:'clientId',value:'other',expectedValue:'client'},f.tx);assert.equal(result.ok,true);
});

test('forbidden role cannot disclose the newly bound client phone or label',async()=>{
 const f=fixture();f.state.projects[0].clientId='other';
 const result=await patchProductContactInTransaction({...manager,roles:['ENGINEER','ACCOUNTANT']},{productId:'p1',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(result.ok,false);if(!result.ok){assert.equal(result.kind,'forbidden');assert.equal(result.currentValue,undefined);assert.equal(result.currentClientLabel,undefined);assert.equal(result.currentClientId,undefined)}
 assert.equal(f.state.locks.length,0);assert.deepEqual(f.state.clients.map(row=>row.phone),['100','999']);assert.equal(f.state.audit.length,0);assert.equal(f.state.events.length,0);
});
import {patchProjectContactInTransaction} from '../src/server/projects/contact-core';
test('project target without products reuses shared contact CAS without manufacturing a product',async()=>{
 const f=fixture();f.tx.product.findUnique=(async()=>{throw new Error('PRODUCT_READ_FORBIDDEN_ON_PROJECT_PATH')}) as unknown as unknown as typeof f.tx.product.findUnique;
 const result=await patchProjectContactInTransaction(manager,{projectId:'project',field:'address',value:'Project address',expectedValue:null},f.tx);
 assert.equal(result.ok,true);assert.equal(f.state.projects[0].address,'Project address');assert.match(f.state.locks[0],/Project/);assert.equal(f.state.audit.length,1);assert.equal(f.state.events.length,1);
});
test('project phone keeps binding conflict context and readonly role guards',async()=>{
 const f=fixture();f.state.projects[0].clientId='other';
 const result=await patchProjectContactInTransaction(manager,{projectId:'project',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(result.ok,false);if(!result.ok){assert.equal(result.kind,'conflict');assert.equal(result.currentValue,'999');assert.equal(result.currentClientId,'other');assert.equal(result.currentClientLabel,'Client')}
 assert.deepEqual(f.state.clients.map(row=>row.phone),['100','999']);assert.equal(f.state.audit.length,0);assert.equal(f.state.events.length,0);
 const forbidden=await patchProjectContactInTransaction({...manager,roles:['ACCOUNTANT','ENGINEER']},{projectId:'project',field:'phone',value:'200',expectedValue:'100',expectedClientId:'client'},f.tx);
 assert.equal(forbidden.ok,false);if(!forbidden.ok){assert.equal(forbidden.kind,'forbidden');assert.equal(forbidden.currentValue,undefined);assert.equal(forbidden.currentClientId,undefined)}
});

 test('retired product address and phone are denied before any reads or locks',async()=>{
 const f=fixture();f.tx.product.findUnique=(async()=>{throw new Error('unexpected product read')}) as unknown as typeof f.tx.product.findUnique;
 for(const field of ['address','phone'] as const){const result=await patchProductContactInTransaction(manager,{productId:'p1',field,value:'new',expectedValue:'old',expectedClientId:'client'},f.tx);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'validation');}
 assert.equal(f.state.locks.length,0);assert.equal(f.state.audit.length,0);assert.equal(f.state.events.length,0);
 });
