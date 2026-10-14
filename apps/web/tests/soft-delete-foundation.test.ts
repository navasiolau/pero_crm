import assert from "node:assert/strict";
import { test } from "node:test";
import { productVisibilityWhere, projectVisibilityWhere, productEditWhere, taskVisibilityWhere, taskExecutionWhere, fileVisibilityWhere, workVisibilityWhere } from "../src/server/access/visibility";
import { matches } from "./helpers/visibility-fixture";
import { type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { patchProductCore, createProductCore, deleteProductCore } from "../src/server/products/core";
import { patchProjectStageTransaction } from "../src/server/projects/stage-core";
import { patchProductPercentageCore } from "../src/server/product-percentage-pay/patch-core";
import { type TaskTransaction } from "../src/server/tasks/transaction";
import { projectProductsVersion, softDeleteProjectCore } from "../src/server/projects/delete-core";
import { isConfirmedProductDelete } from "../src/lib/product-delete-ui";
import { PROJECT_DELETE_WARNING, isConfirmedProjectDelete } from "../src/lib/project-delete-ui";

{ // Источник: soft-delete-foundation.test.ts
const manager={id:'manager',roles:['MANAGER' as const]};
const project={id:'j',deletedAt:null};const product={id:'p',deletedAt:null,project,engineerId:'manager',status:'DESIGN'};
test('manager never bypasses deleted product or parent in read/edit predicates',()=>{
 for(const predicate of [productVisibilityWhere(manager),productEditWhere(manager)]){assert.equal(matches(product,predicate),true);assert.equal(matches({...product,deletedAt:new Date()},predicate),false);assert.equal(matches({...product,project:{...project,deletedAt:new Date()}},predicate),false);}
 assert.equal(matches({...project,deletedAt:new Date()},projectVisibilityWhere(manager)),false);
});
test('work task execution and stored-file predicates reject deleted ancestors',()=>{
 for(const [kind,predicate] of [['task',taskVisibilityWhere(manager)],['execution',taskExecutionWhere(manager)],['file',fileVisibilityWhere(manager)],['work',workVisibilityWhere(manager)]] as const){const row={id:'child',productId:'p',project,product,...(kind==='file'?{taskId:null,task:null}:{})};assert.equal(matches(row,predicate),true);assert.equal(matches({...row,product:{...product,deletedAt:new Date()}},predicate),false);assert.equal(matches({...row,project:{...project,deletedAt:new Date()}},predicate),false);}
});





const actor={...manager,name:'Manager',source:'web' as const};
function closedTx(deletedParent:boolean){
 const row={...product,projectId:'j',project:{...project,deletedAt:deletedParent?new Date():null},deletedAt:deletedParent?null:new Date()};let receiptReads=0;
 const tx={ $queryRaw:async()=>[],task:{findMany:async()=>[]},product:{findFirst:async({where}:{where:Record<string,unknown>})=>matches(row,where)?row:null,findUnique:async({where}:{where:Record<string,unknown>})=>matches(row,where)?row:null},project:{findUnique:async({where}:{where:Record<string,unknown>})=>matches({...project,deletedAt:new Date()},where)?project:null},changeLog:{findUnique:async()=>{receiptReads++;throw Error('Deleted entity reached receipt replay');}}} as unknown as Prisma.TransactionClient;
 return{tx,receipts:()=>receiptReads};
}
test('genuine inline product and percentage cores refuse deleted scopes before reading old successful receipts',async()=>{
 for(const deletedParent of [false,true]){
  const f=closedTx(deletedParent);const result=await patchProductCore(actor,{productId:'p',field:'title',value:'new',expectedValue:'old',clientMutationId:randomUUID()},async work=>work(f.tx));assert.equal(result.kind,"not-found");
  const percentage=await patchProductPercentageCore(actor,{productId:'p',kind:'ENGINEERING',field:'ratePercent',value:'5',expectedValue:null,expectedRevision:0,clientMutationId:randomUUID()},f.tx);assert.equal(percentage.ok,false);assert.equal(f.receipts(),0);
 }
});
test('genuine project stage transaction refuses deleted project before historical ACK or outbox writes',async()=>{
 const f=closedTx(true);const result=await patchProjectStageTransaction(actor,{projectId:'j',expectedStage:'LEAD',toStage:'IN_WORK',clientMutationId:randomUUID()},f.tx);assert.equal(result.result.ok,false);assert.equal(f.receipts(),0);
});

test('genuine product creation counts deleted sibling suffix without reusing a historical number',async()=>{
 let numberQuery:unknown;const tx={$queryRaw:async()=>[],project:{findUnique:async()=>({id:'j',number:'205',currency:'BYN'})},product:{findMany:async({where}:{where:unknown})=>{numberQuery=where;return[{suffixInt:9,deletedAt:new Date()}];},create:async({data}:{data:Record<string,unknown>})=>({id:'new',...data})},orgSetting:{findUnique:async()=>null},changeLog:{create:async()=>({})}} as unknown as Prisma.TransactionClient;
 const result=await createProductCore(actor,{projectId:'j',title:'New',quantity:1},async work=>work(tx));assert.equal(result.ok,true);assert.equal(result.ok&&result.product.number,'205.10');assert.deepEqual(numberQuery,{projectId:'j'},'number allocation intentionally includes deleted rows');
});
}

{ // Источник: product-soft-delete.test.ts
const actor={id:'m',name:'M',roles:['MANAGER'] as ['MANAGER'],source:'web' as const},uuid='12222222-2222-4222-8222-222222222222';
function fixture(){
 const product={id:'p',projectId:'j',number:'1.1',title:'History',updatedAt:new Date('2026-10-03T10:00:00Z'),deletedAt:null as Date|null,deletedById:null as string|null,_count:{tasks:1,works:1,projectMaterials:1,stockMovements:1}},project={id:'j',deletedAt:null as Date|null};
 const history={files:[{id:'f'}],tasks:[{id:'t'}],works:[{id:'w'}],completion:[{id:'immutable',amount:'100.00'}],payroll:[{id:'pay',amount:'100.00'}]},logs=new Map<string,Record<string,unknown>>();let timer=0;
 const tx={$queryRaw:async()=>[],product:{findUnique:async()=>product,updateMany:async({where,data}:{where:{updatedAt:Date;deletedAt:null};data:{deletedAt:Date;deletedById:string}})=>{if(product.deletedAt||+product.updatedAt!==+where.updatedAt)return{count:0};Object.assign(product,data);return{count:1}},delete:async()=>{throw Error('PHYSICAL_DELETE_FORBIDDEN')}},project:{findUnique:async()=>project},timeEntry:{count:async()=>timer},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.get(where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.set(data.id as string,data);return data}}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=async callback=>{const before=structuredClone(product),old=new Map(logs);try{return await callback(tx)}catch(e){Object.assign(product,before);logs.clear();old.forEach((v,k)=>logs.set(k,v));throw e;}};
 return{product,project,history,logs,tx,transaction,setTimer:(n:number)=>{timer=n;}};
}
test('legacy missing baseline fails closed, audit failure rolls tombstone back',async()=>{
 const f=fixture();assert.equal((await deleteProductCore(actor,'p',f.transaction)).ok,false);f.tx.changeLog.create=(async()=>{throw Error('AUDIT_FAILURE')}) as unknown as typeof f.tx.changeLog.create;const result=await deleteProductCore(actor,'p',f.transaction,{expectedUpdatedAt:f.product.updatedAt.toISOString(),clientMutationId:uuid});assert.equal(result.ok,false);assert.equal(f.product.deletedAt,null);assert.equal(f.product.deletedById,null);assert.equal(f.logs.size,0);
});
}

{ // Источник: project-soft-delete.test.ts
const actor={id:'m',name:'M',roles:['MANAGER'] as ['MANAGER'],source:'web' as const};
function fixture(){
 const date=new Date('2026-10-03T10:00:00Z'),project={id:'j',number:'1',title:'Project',updatedAt:date,deletedAt:null as Date|null,deletedById:null as string|null},products=[{id:'b',projectId:'j',updatedAt:date,deletedAt:new Date('2026-10-02T10:00:00Z') as Date|null,deletedById:'previous' as string|null},{id:'a',projectId:'j',updatedAt:date,deletedAt:null as Date|null,deletedById:null as string|null}],history={files:[{id:'f'}],works:[{id:'w'}],payroll:[{amount:'100.00'}],payments:[{amount:'50.00'}]},logs=new Map<string,Record<string,unknown>>();let timer=0;
 const tx={$queryRaw:async()=>[],project:{findUnique:async()=>project,updateMany:async({where,data}:{where:{updatedAt:Date};data:{deletedAt:Date;deletedById:string}})=>{if(project.deletedAt||+project.updatedAt!==+where.updatedAt)return{count:0};Object.assign(project,data);return{count:1}}},product:{findMany:async()=>products,updateMany:async({data}:{data:{deletedAt:Date;deletedById:string}})=>{const live=products.filter(p=>p.deletedAt===null);live.forEach(p=>Object.assign(p,data));return{count:live.length}}},timeEntry:{count:async()=>timer},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.get(where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.set(data.id as string,data);return data}}} as unknown as Prisma.TransactionClient;
 const input={projectId:'j',expectedUpdatedAt:date.toISOString(),expectedProductsVersion:projectProductsVersion(products),clientMutationId:'12222222-2222-4222-8222-222222222222'};
 async function transaction(){const p=structuredClone(project),rows=structuredClone(products);try{return await softDeleteProjectCore(tx,actor,input)}catch(e){Object.assign(project,p);products.splice(0,products.length,...rows);logs.clear();throw e;}}
 return{tx,project,products,history,logs,input,transaction,setTimer:(n:number)=>{timer=n;}};
}
test('project-wide or product timer refuses before any parent/child/audit write',async()=>{for(const scope of ['project-wide','product']){const f=fixture();f.setTimer(1);let checked:unknown;f.tx.timeEntry.count=(async({where}: {where:unknown})=>{checked=where;return 1;}) as unknown as typeof f.tx.timeEntry.count;const before=structuredClone({project:f.project,products:f.products,history:f.history});const result=await f.transaction();assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'active-timer');assert.deepEqual(checked,{source:'timer',stoppedAt:null,task:{projectId:'j'}});assert.deepEqual({project:f.project,products:f.products,history:f.history},before);assert.equal(f.logs.size,0);void scope;}});
test('stale project or added/edited/individually deleted child conflicts with captured aggregate',async()=>{for(const scenario of ['project','add','edit','delete']){const f=fixture();if(scenario==='project')f.project.updatedAt=new Date('2026-10-03T11:00:00Z');if(scenario==='add')f.products.push({...f.products[1],id:'new'});if(scenario==='edit')f.products[1].updatedAt=new Date('2026-10-03T11:00:00Z');if(scenario==='delete'){f.products[1].deletedAt=new Date();f.products[1].deletedById='other';}const before=structuredClone({project:f.project,products:f.products});const result=await f.transaction();assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'conflict');assert.deepEqual({project:f.project,products:f.products},before);assert.equal(f.logs.size,0);}});
test('aggregate version is codepoint sorted independent of query ordering; audit failure rolls back parent and live children',async()=>{const f=fixture();assert.equal(projectProductsVersion(f.products),projectProductsVersion([...f.products].reverse()));const before=structuredClone({project:f.project,products:f.products});f.tx.changeLog.create=(async()=>{throw Error('AUDIT_FAILURE')}) as unknown as typeof f.tx.changeLog.create;await assert.rejects(f.transaction(),/AUDIT_FAILURE/);assert.deepEqual({project:f.project,products:f.products},before);assert.equal(f.logs.size,0);});
}

{ // Источник: product-delete-ui.test.ts
const request={productId:'p',expectedUpdatedAt:'2026-10-03T10:00:00.000Z',clientMutationId:'12222222-2222-4222-8222-222222222222'},ack={ok:true,productId:'p',projectId:'j',deletedAt:'2026-10-03T11:00:00.000Z',clientMutationId:request.clientMutationId};
test('only actual matched delete/replay ACK permits leaving hidden product; malformed/stale responses remain unconfirmed',()=>{assert.equal(isConfirmedProductDelete(ack,request),true);assert.equal(isConfirmedProductDelete({...ack,repeated:true},request),true);for(const value of [null,{...ack,ok:false},{...ack,productId:'foreign'},{...ack,clientMutationId:'other'},{...ack,deletedAt:'invalid'},{...ack,deletedAt:''},{...ack,projectId:''}])assert.equal(isConfirmedProductDelete(value,request),false);});
}

{ // Источник: project-delete-ui.test.ts
const input={projectId:'j',expectedUpdatedAt:'2026-10-03T10:00:00.000Z',expectedProductsVersion:'a'.repeat(64),clientMutationId:'12222222-2222-4222-8222-222222222222'},ack={ok:true,projectId:'j',deletedAt:'2026-10-03T11:00:00.000Z',clientMutationId:input.clientMutationId,affectedProductIds:['p']};
test('owner exact warning and actual matched project ACK/replay; stale/malformed responses never confirm navigation',()=>{assert.equal(PROJECT_DELETE_WARNING,'Внимание! Проект будет удален вместе со всеми изделиями!');assert.equal(isConfirmedProjectDelete(ack,input),true);assert.equal(isConfirmedProjectDelete({...ack,repeated:true},input),true);for(const value of [null,{...ack,ok:false},{...ack,projectId:'foreign'},{...ack,clientMutationId:'wrong'},{...ack,deletedAt:'invalid'},{...ack,affectedProductIds:null}])assert.equal(isConfirmedProjectDelete(value,input),false);});
}
