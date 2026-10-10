import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Prisma,type Role} from '@prisma/client';
import {createWorkerTaskAllocationCore} from '../src/server/tasks/worker-allocation-core';
import type {TaskTransaction} from '../src/server/tasks/transaction';
const actor={id:'creator',name:'Worker',roles:['WORKER' as const],source:'web' as const};
function input(){return{projectId:'project',productId:'product',workId:'work',assigneeId:'recipient',title:'Сборка',type:'Производство',quantity:'2.00',dueAt:'2026-10-10',estimateMinutes:60,dependencyIds:[],clientMutationId:randomUUID()};}
function fixture(){
 const users=new Map([['creator',{id:'creator',name:'Creator',roles:['WORKER'],active:true}],['recipient',{id:'recipient',name:'Recipient',roles:['WORKER'],active:true}]]);
 const product={id:'product',projectId:'project',status:'PRODUCTION',deletedAt:null,project:{deletedAt:null}};
 const work={id:'work',projectId:'project',productId:'product',quantity:new Prisma.Decimal('10.00'),priceSnapshot:new Prisma.Decimal('12.34'),paymentKind:'LEGACY',stagePayPoolId:null};
 const tasks:Record<string,unknown>[]=[],logs:Record<string,unknown>[]=[],events:Record<string,unknown>[]=[];let auditFailure=false,serial=0;
 const tx={$queryRaw:async()=>[],user:{findUnique:async({where}:{where:{id:string}})=>users.get(where.id)??null},project:{findUnique:async()=>({id:'project',currency:'BYN',deletedAt:null})},product:{findFirst:async()=>product},work:{findUnique:async()=>({...work,tasks}),findFirst:async()=>({...work,tasks})},task:{findUnique:async({where}:{where:{id:string}})=>tasks.find(task=>task.id===where.id)??null,findMany:async({where}:{where:Record<string,unknown>})=>{
  if(where.workId)return tasks;const ids=(where.id as {in?:string[]}|undefined)?.in;const groups=(where.allocationGroupId as {in?:string[]}|undefined)?.in;
  return tasks.filter(t=>ids?ids.includes(t.id as string):groups?groups.includes(t.allocationGroupId as string):false);
 },create:async({data}:{data:Record<string,unknown>})=>{const row={id:'task-'+(++serial),...data,quantity:new Prisma.Decimal(String(data.quantity))};tasks.push(row);return row;}},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{if(auditFailure)throw Error('QA_AUDIT_FAILURE');logs.push(data);return data;}},domainEvent:{create:async({data}:{data:Record<string,unknown>})=>{const row={id:'event-'+events.length,...data};events.push(row);return row;}}} as unknown as Prisma.TransactionClient;
 let queue=Promise.resolve();const transaction:TaskTransaction=fn=>{
  const pending=queue.then(async()=>{const lengths=[tasks.length,logs.length,events.length];try{return await fn(tx);}catch(error){tasks.splice(lengths[0]);logs.splice(lengths[1]);events.splice(lengths[2]);throw error;}});queue=pending.then(()=>{},()=>{});return pending;
 };
 return{tx,transaction,users,product,work,tasks,logs,events,failAudit(){auditFailure=true;}};
}
test('worker assigns another active WORKER; task/audit/event/receipt once, immutable work and no shares',async()=>{
 const f=fixture(),request=input(),before={...f.work};const result=await createWorkerTaskAllocationCore(actor,request,f.transaction);
 assert.equal(result.ok,true);assert.equal(f.tasks.length,1);assert.equal(f.tasks[0].assigneeId,'recipient');assert.equal((f.tasks[0].quantity as Prisma.Decimal).toFixed(2),'2.00');assert.equal(f.tasks[0].createdById,'creator');assert.equal(f.tasks[0].status,'NEW');assert.equal(f.tasks[0].allocationGroupId,undefined);assert.equal(f.tasks[0].executorShare,undefined);assert.deepEqual(f.work,before);assert.equal(f.events.length,1);
 const n=f.logs.length,replay=await createWorkerTaskAllocationCore(actor,request,f.transaction);assert.equal(replay.ok,true);assert.equal(replay.repeated,true);assert.equal(f.tasks.length,1);assert.equal(f.logs.length,n);assert.equal(f.events.length,1);
 assert.equal((await createWorkerTaskAllocationCore(actor,{...request,quantity:'3.00'},f.transaction)).ok,false);assert.equal(f.tasks.length,1);
});
test('live role, active WORKER recipient, PRODUCTION and exact work context are required',async()=>{
 for(const change of ['creator-role','recipient-role','inactive','stage','context','pool','missing-price'] as const){
  const f=fixture();if(change==='creator-role')f.users.get('creator')!.roles=['MANAGER'];if(change==='recipient-role')f.users.get('recipient')!.roles=['ENGINEER'];if(change==='inactive')f.users.get('recipient')!.active=false;if(change==='stage')f.product.status='INSTALLATION';if(change==='context')f.work.productId='other';if(change==='pool')Object.assign(f.work,{stagePayPoolId:'pool'});if(change==='missing-price')Object.assign(f.work,{priceSnapshot:null});
  assert.equal((await createWorkerTaskAllocationCore(actor,input(),f.transaction)).ok,false,change);assert.equal(f.tasks.length,0);assert.equal(f.logs.length,0);assert.equal(f.events.length,0);
 }
});
test('legacy group volume counted once and concurrent allocations cannot exceed free quantity',async()=>{
 const f=fixture();f.tasks.push({id:'old1',quantity:'6.00',allocationGroupId:'old-group'},{id:'old2',quantity:'6.00',allocationGroupId:'old-group'});const old=structuredClone(f.tasks);
 const results=await Promise.all([createWorkerTaskAllocationCore(actor,{...input(),quantity:'3.00'},f.transaction),createWorkerTaskAllocationCore(actor,{...input(),quantity:'3.00'},f.transaction)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(f.tasks.length,3);assert.deepEqual(f.tasks.slice(0,2),old);assert.equal(f.events.length,1);
});
test('strict quantity, mandatory estimate and monetary injection fail without mutations',async()=>{
 for(const patch of [{quantity:'0'},{quantity:'1.001'},{quantity:'11'},{priceSnapshot:'0'},{executorShare:0.5},{estimateMinutes:0},{dependencyIds:['missing']}]){
  const f=fixture();assert.equal((await createWorkerTaskAllocationCore(actor,{...input(),...patch},f.transaction)).ok,false);assert.equal(f.tasks.length,0);assert.equal(f.logs.length,0);assert.equal(f.events.length,0);
 }
});
test('audit failure rolls back new task and outbox facts',async()=>{
 const f=fixture();f.failAudit();assert.equal((await createWorkerTaskAllocationCore(actor,input(),f.transaction)).ok,false);assert.equal(f.tasks.length,0);assert.equal(f.logs.length,0);assert.equal(f.events.length,0);
});
test('field assignments require a matching recipient status, including combined roles',async()=>{
 const pairs:[Role[],Role[],string][]=[[ ['MOUNTER'],['WORKER','MOUNTER'],'INSTALLATION' ],[ ['WORKER'],['WORKER','MOUNTER'],'STORAGE' ],[ ['MOUNTER'],['MOUNTER'],'INSTALLATION' ]];
 for(const [actorRoles,recipientRoles,status] of pairs){
  const f=fixture();f.product.status=status;f.users.get('creator')!.roles=[...actorRoles];f.users.get('recipient')!.roles=[...recipientRoles];
  const result=await createWorkerTaskAllocationCore({...actor,roles:actorRoles},input(),f.transaction);
  assert.equal(result.ok,true);assert.equal(f.tasks.length,1);assert.equal(f.events.length,1);
 }
});
test('combined WORKER recipient and self assignment are allowed; missing role cannot be forged',async()=>{
 const f=fixture();f.users.get('recipient')!.roles=['MOUNTER','WORKER'];assert.equal((await createWorkerTaskAllocationCore(actor,input(),f.transaction)).ok,true);
 assert.equal((await createWorkerTaskAllocationCore(actor,{...input(),assigneeId:'creator'},f.transaction)).ok,true);
 f.users.get('creator')!.active=false;assert.equal((await createWorkerTaskAllocationCore(actor,input(),f.transaction)).ok,false);assert.equal(f.tasks.length,2);
});
test('dependency expansion preserves whole legacy group and denies foreign member without new facts',async()=>{
 const f=fixture();f.tasks.push({id:'d1',projectId:'project',productId:'product',quantity:'1',allocationGroupId:'g'},{id:'d2',projectId:'project',productId:'product',quantity:'1',allocationGroupId:'g'});
 assert.equal((await createWorkerTaskAllocationCore(actor,{...input(),dependencyIds:['d1']},f.transaction)).ok,true);
 assert.deepEqual((f.tasks[2].dependencies as {create:{dependsOnId:string}[]}).create.map(x=>x.dependsOnId).sort(),['d1','d2']);
 const other=fixture();other.tasks.push({id:'d1',projectId:'project',productId:'product',quantity:'1',allocationGroupId:'g'},{id:'d2',projectId:'project',productId:'other',quantity:'1',allocationGroupId:'g'});
 assert.equal((await createWorkerTaskAllocationCore(actor,{...input(),dependencyIds:['d1']},other.transaction)).ok,false);assert.equal(other.tasks.length,2);assert.equal(other.events.length,0);assert.equal(other.logs.length,0);
});
test('receipt never confirms a deleted or subsequently changed assignment; no second task',async()=>{
 const f=fixture(),request=input();assert.equal((await createWorkerTaskAllocationCore(actor,request,f.transaction)).ok,true);f.tasks[0].quantity=new Prisma.Decimal(3);
 const n=f.logs.length,result=await createWorkerTaskAllocationCore(actor,request,f.transaction);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'conflict');assert.equal(f.tasks.length,1);assert.equal(f.logs.length,n);
});
test('measurement cannot bypass its photo completion requirement',async()=>{
 const f=fixture();assert.equal((await createWorkerTaskAllocationCore(actor,{...input(),type:'Замер',requiresPhoto:false},f.transaction)).ok,true);assert.equal(f.tasks[0].requiresPhoto,true);
});
test('unknown legacy physical quantity is preserved without guessing free budget',async()=>{
 const f=fixture();f.tasks.push({id:'legacy',quantity:null,allocationGroupId:null});const result=await createWorkerTaskAllocationCore(actor,input(),f.transaction);
 assert.equal(result.ok,false);assert.equal(f.tasks.length,1);assert.equal(f.logs.length,0);assert.equal(f.events.length,0);assert.equal(f.tasks[0].quantity,null);
});
