import assert from 'node:assert/strict';
import {test} from 'node:test';
import {productVisibilityWhere,projectVisibilityWhere,productEditWhere,taskVisibilityWhere,taskExecutionWhere,fileVisibilityWhere,workVisibilityWhere} from '../src/server/access/visibility';
import {matches} from './helpers/visibility-fixture';
const manager={id:'manager',roles:['MANAGER' as const]};
const project={id:'j',deletedAt:null};const product={id:'p',deletedAt:null,project,engineerId:'manager',status:'DESIGN'};
test('manager never bypasses deleted product or parent in read/edit predicates',()=>{
 for(const predicate of [productVisibilityWhere(manager),productEditWhere(manager)]){assert.equal(matches(product,predicate),true);assert.equal(matches({...product,deletedAt:new Date()},predicate),false);assert.equal(matches({...product,project:{...project,deletedAt:new Date()}},predicate),false);}
 assert.equal(matches({...project,deletedAt:new Date()},projectVisibilityWhere(manager)),false);
});
test('work task execution and stored-file predicates reject deleted ancestors',()=>{
 for(const predicate of [taskVisibilityWhere(manager),taskExecutionWhere(manager),fileVisibilityWhere(manager),workVisibilityWhere(manager)]){const row={id:'child',productId:'p',project,product};assert.equal(matches(row,predicate),true);assert.equal(matches({...row,product:{...product,deletedAt:new Date()}},predicate),false);assert.equal(matches({...row,project:{...project,deletedAt:new Date()}},predicate),false);}
});
import type {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {patchProductCore} from '../src/server/products/core';
import {patchProjectStageTransaction} from '../src/server/projects/stage-core';
import {patchProductPercentageCore} from '../src/server/product-percentage-pay/patch-core';
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
import {createProductCore} from '../src/server/products/core';
test('genuine product creation counts deleted sibling suffix without reusing a historical number',async()=>{
 let numberQuery:unknown;const tx={$queryRaw:async()=>[],project:{findUnique:async()=>({id:'j',number:'205',currency:'BYN'})},product:{findMany:async({where}:{where:unknown})=>{numberQuery=where;return[{suffixInt:9,deletedAt:new Date()}];},create:async({data}:{data:Record<string,unknown>})=>({id:'new',...data})},orgSetting:{findUnique:async()=>null},changeLog:{create:async()=>({})}} as unknown as Prisma.TransactionClient;
 const result=await createProductCore(actor,{projectId:'j',title:'New',quantity:1},async work=>work(tx));assert.equal(result.ok,true);assert.equal(result.ok&&result.product.number,'205.10');assert.deepEqual(numberQuery,{projectId:'j'},'number allocation intentionally includes deleted rows');
});
