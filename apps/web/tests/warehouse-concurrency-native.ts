import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PrismaClient,Prisma} from '@prisma/client';
import {nativeAcceptanceBinding,nativeDatabaseIdentity,type NativeDeclaration} from './helpers/native-acceptance-target';
import {nativeSnapshot,lockExactOwnedRows,assertNoForeignReferences,type OwnedRowKeys} from './helpers/native-acceptance-snapshot';
import {nativeJournal} from './helpers/native-acceptance-journal';

const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const requestKeys=['income','issueA','issueB','duplicateIncome','returnA','returnB'] as const;
type Requests=Record<typeof requestKeys[number],string>;
type Ids={actor:string;client:string;project:string;product:string;material:string;line:string};
export type WarehousePlan={version:1;revision:string;target:'local'|'staging';runId:string;scenarioId:string;ids:Ids;requests:Requests;before:Awaited<ReturnType<typeof nativeSnapshot>>;stateDigest:string};
type RunInput=NativeDeclaration&{plan:WarehousePlan;planSha256:string;outerPreparationReceiptSha256:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const graph=(runId:string):Ids=>{const tag='QA_WH163_'+runId;return{actor:tag,client:tag+'-client',project:tag+'-project',product:tag+'-product',material:tag+'-material',line:tag+'-line'};};
const initialKeys=(ids:Ids):OwnedRowKeys=>({User:{column:'id',ids:[ids.actor]},Client:{column:'id',ids:[ids.client]},Project:{column:'id',ids:[ids.project]},Product:{column:'id',ids:[ids.product]},Material:{column:'id',ids:[ids.material]},ProjectMaterial:{column:'id',ids:[ids.line]}});
export function validateWarehousePlan(input:RunInput) {
 assert.equal(input.plan.version,1,'WAREHOUSE_PLAN_VERSION');
 assert.deepEqual({revision:input.plan.revision,target:input.plan.target,runId:input.plan.runId,scenarioId:input.plan.scenarioId},{revision:input.revision,target:input.target,runId:input.runId,scenarioId:input.scenarioId},'WAREHOUSE_PLAN_CONTEXT');
 assert.deepEqual(input.plan.ids,graph(input.runId),'WAREHOUSE_PLAN_GRAPH');
 assert.deepEqual(Object.keys(input.plan.requests).sort(),[...requestKeys].sort(),'WAREHOUSE_PLAN_REQUEST_SET');
 const requests=Object.values(input.plan.requests);
 assert.ok(requests.every(id=>UUID.test(id))&&new Set(requests).size===requests.length,'WAREHOUSE_PLAN_EXACT_UUIDS');
 assert.match(input.plan.stateDigest,SHA,'WAREHOUSE_STATE_FINGERPRINT');
 assert.equal(digest(input.plan.before.snapshot),input.plan.before.digest,'WAREHOUSE_BASELINE_FINGERPRINT');
 assert.match(input.planSha256,SHA,'WAREHOUSE_PLAN_SHA_REQUIRED');assert.equal(digest(input.plan),input.planSha256,'WAREHOUSE_PLAN_CHANGED');
 assert.match(input.outerPreparationReceiptSha256,SHA,'OUTER_DURABLE_PRE_REQUIRED');
}
// Отдельный read-only этап: координатор fsyncs raw receipt/plan ДО последующего native bundle.
export async function inspectWarehouseConcurrencyAcceptance(input:NativeDeclaration&{nativeScenarioId:string}) {
 assert.match(input.nativeScenarioId,/^[a-z0-9][a-z0-9.-]{0,100}$/,'NATIVE_SCENARIO_REQUIRED');
 const binding=nativeAcceptanceBinding(input),{PrismaClient}=await import('@prisma/client'),db=new PrismaClient({datasourceUrl:binding.url});
 try {
  await nativeDatabaseIdentity(db,input);
  const plan=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   assert.equal((await tx.materialUnit.findUnique({where:{id:'warehouse-unit-piece'},select:{id:true}}))?.id,'warehouse-unit-piece','EXISTING_MATERIAL_UNIT_REQUIRED');
   const state=await tx.warehouseAccountingState.findUniqueOrThrow({where:{id:'main'}});
   assert.equal(state.phase,'ACTIVE','EXISTING_ACTIVE_WAREHOUSE_REQUIRED');
   const ids=graph(input.runId);await assertFreshGraph(tx,ids);
   const before=await nativeSnapshot(tx),requests=Object.fromEntries(requestKeys.map(key=>[key,randomUUID()])) as Requests;
   return {version:1 as const,revision:input.revision,target:input.target,runId:input.runId,scenarioId:input.nativeScenarioId,ids,requests,before,stateDigest:digest(state)};
  },{isolationLevel:'RepeatableRead',timeout:60000});
  return {status:'PASS',level:'data-integrity',revision:input.revision,target:input.target,runId:input.runId,scenarioId:input.scenarioId,producerId:'warehouse-concurrency',producerVersion:2,identity:binding.identity,
   checks:[{id:'native-inspect-read-only',status:'PASS'},{id:'existing-unit-prerequisite',status:'PASS'},{id:'readonly-original-baseline',status:'PASS'},{id:'fresh-exact-graph-and-uuids',status:'PASS'}],
   preservation:{mode:'readonly',status:'PASS',beforeDigest:plan.before.digest,afterDigest:plan.before.digest},plan,planSha256:digest(plan)};
 } finally {await db.$disconnect();}
}
async function assertFreshGraph(db:Pick<Prisma.TransactionClient,'$queryRawUnsafe'>,ids:Ids) {
 for(const [table,value] of Object.entries(initialKeys(ids))) {
  const rows=await db.$queryRawUnsafe<{count:string}[]>('SELECT count(*)::text AS count FROM public."'+table+'" WHERE "'+value.column+'" = $1',value.ids[0]);
  assert.equal(rows[0]?.count,'0','FRESH_EXACT_GRAPH_REQUIRED');
 }
}
export async function runWarehouseConcurrencyAcceptance(input:RunInput) {
 validateWarehousePlan(input); // Не конструируем клиент без outer durable PRE.
 const binding=nativeAcceptanceBinding(input),{PrismaClient}=await import('@prisma/client');
 const db=new PrismaClient({datasourceUrl:binding.url}),other=new PrismaClient({datasourceUrl:binding.url});
 const {ids,requests,before}=input.plan,tag=ids.actor,planned=new Set(Object.values(requests));
 let writesStarted=false,cleanupVerified=false,failure:unknown,hasFailure=false;
 try {
  await nativeDatabaseIdentity(db,input);await nativeDatabaseIdentity(other,input);
  const state=await db.warehouseAccountingState.findUniqueOrThrow({where:{id:'main'}});
  assert.equal(state.phase,'ACTIVE','EXISTING_ACTIVE_WAREHOUSE_REQUIRED');assert.equal(digest(state),input.plan.stateDigest,'STATE_CHANGED_SINCE_PRE');
  assert.deepEqual(await nativeSnapshot(db),before,'ORIGINAL_CHANGED_SINCE_PRE');await assertFreshGraph(db,ids);
  const save=await nativeJournal(input);
  await save('warehouse.native.pre',{plan:input.plan,planSha256:input.planSha256,outerPreparationReceiptSha256:input.outerPreparationReceiptSha256,phase:'BEFORE_WRITES'});
  const {warehouseMove}=await import('../src/server/warehouse/accounting');
  const actor={id:ids.actor,roles:['ADMIN' as const]};
  writesStarted=true; // Даже потерянный ACK setup сохраняет PRE и требует inspect.
  await db.$transaction(async tx=>{
   await assertFreshGraph(tx,ids);
   await tx.user.create({data:{id:ids.actor,name:tag,email:tag+'@qa.invalid',active:false,passwordHash:'NO_QA_LOGIN',roles:['ADMIN']}});
   await tx.client.create({data:{id:ids.client,name:tag,phone:'QA163'}});
   const max=(await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0;
   await tx.project.create({data:{id:ids.project,number:tag,numberInt:max+1,title:tag,clientId:ids.client}});
   await tx.product.create({data:{id:ids.product,projectId:ids.project,number:tag+'.1',title:tag,status:'PRODUCTION'}});
   await tx.material.create({data:{id:ids.material,name:tag,purchasePrice:0,unitId:'warehouse-unit-piece'}});
   await tx.projectMaterial.create({data:{id:ids.line,productId:ids.product,materialId:ids.material,quantity:100}});
  },{isolationLevel:'Serializable'});
  await save('warehouse.setup-ack',{phase:'SETUP_ACK',planSha256:input.planSha256});
  const backendPids=new Set<number>();
  const move=(client:PrismaClient,payload:Parameters<typeof warehouseMove>[2])=>client.$transaction(async tx=>{
   const [connection]=await tx.$queryRawUnsafe<{pid:number}[]>('SELECT pg_backend_pid() AS pid');backendPids.add(connection.pid);
   return warehouseMove(tx,actor,payload);
  },{maxWait:10000,timeout:15000});
  await move(db,{kind:'INCOME',clientMutationId:requests.income,materialId:ids.material,quantity:5,unitPrice:5});
  const issue=await Promise.allSettled([move(db,{kind:'EXPENSE',clientMutationId:requests.issueA,projectMaterialId:ids.line,quantity:4}),move(other,{kind:'EXPENSE',clientMutationId:requests.issueB,projectMaterialId:ids.line,quantity:4})]);
  assert.equal(issue.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(backendPids.size,2,'INDEPENDENT_BACKEND_CONNECTIONS_REQUIRED');
  assert.equal((await db.warehouseBalance.findUniqueOrThrow({where:{materialId:ids.material}})).quantity.toString(),'1');
  const receipt={kind:'INCOME' as const,clientMutationId:requests.duplicateIncome,materialId:ids.material,quantity:2,unitPrice:9};
  const duplicate=await Promise.all([move(db,receipt),move(other,receipt)]);
  assert.equal(duplicate.filter(item=>item.repeated).length,1);
  assert.equal(await db.stockMovement.count({where:{materialId:ids.material,type:'INCOME'}}),2);
  const issued=await db.stockMovement.findFirstOrThrow({where:{materialId:ids.material,type:'EXPENSE',createdById:ids.actor}});
  const returned=await Promise.allSettled([move(db,{kind:'RETURN',clientMutationId:requests.returnA,projectMaterialId:ids.line,quantity:3,sourceMovementId:issued.id}),move(other,{kind:'RETURN',clientMutationId:requests.returnB,projectMaterialId:ids.line,quantity:3,sourceMovementId:issued.id})]);
  assert.equal(returned.filter(item=>item.status==='fulfilled').length,1);
  assert.equal((await db.warehouseMovementValuation.findUniqueOrThrow({where:{movementId:issued.id}})).returnedQuantity.toString(),'3');
  assert.equal((await db.warehouseBalance.findUniqueOrThrow({where:{materialId:ids.material}})).quantity.toString(),'6');
  // Установленные receipts из exact actor/material/UUID, а не из существующего state.runId.
  const movements=await db.stockMovement.findMany({where:{materialId:ids.material},select:{id:true,createdById:true}});
  assert.ok(movements.length===4&&movements.every(row=>row.createdById===ids.actor),'EXACT_OWNED_MOVEMENTS_REQUIRED');
  const movementIds=movements.map(row=>row.id);
  const valuations=await db.warehouseMovementValuation.findMany({where:{movementId:{in:movementIds}},select:{id:true,clientMutationId:true,movementId:true,actorId:true,runId:true}});
  assert.equal(valuations.length,4,'OWNED_VALUATION_SET_REQUIRED');
  assert.ok(valuations.every(row=>row.actorId===ids.actor&&row.runId===state.runId&&planned.has(row.clientMutationId)),'OWNED_RECEIPT_SCOPE_REQUIRED');
  const eventIds=valuations.map(row=>'warehouse94-'+row.clientMutationId),keys:OwnedRowKeys={...initialKeys(ids),StockMovement:{column:'id',ids:movementIds},WarehouseMovementValuation:{column:'id',ids:valuations.map(row=>row.id)},WarehouseBalance:{column:'materialId',ids:[ids.material]},DomainEvent:{column:'id',ids:eventIds},ChangeLog:{column:'id',ids:eventIds}};
  await save('warehouse.effects-ack',{phase:'EFFECTS_ACK',planSha256:input.planSha256,keys});
  await db.$transaction(async tx=>{
   await tx.$queryRawUnsafe("SET LOCAL lock_timeout = '5s'");
   await tx.$queryRawUnsafe('SELECT 1 AS locked FROM pg_advisory_xact_lock(18436,94001)');
   assert.equal(digest(await tx.warehouseAccountingState.findUnique({where:{id:'main'}})),input.plan.stateDigest,'WAREHOUSE_STATE_CHANGED');
   await lockExactOwnedRows(tx,keys);
   assert.equal(await tx.domainEvent.count({where:{id:{in:eventIds},actor:ids.actor}}),valuations.length,'OWNED_EVENT_SET_REQUIRED');
   assert.equal(await tx.changeLog.count({where:{id:{in:eventIds},actorId:ids.actor,entityId:{in:movementIds}}}),valuations.length,'OWNED_AUDIT_SET_REQUIRED');
   await assertNoForeignReferences(tx,keys);
   assert.deepEqual(await nativeSnapshot(tx,keys),before,'ORIGINAL_CHANGED_BEFORE_FIRST_DELETE');
   // Все FKactions проверены ДО firstdelete. Rowlocks блокируют новые incoming FK.
   await tx.domainEvent.deleteMany({where:{id:{in:eventIds},actor:ids.actor}});
   await tx.changeLog.deleteMany({where:{id:{in:eventIds},actorId:ids.actor,entityId:{in:movementIds}}});
   await tx.warehouseMovementValuation.deleteMany({where:{id:{in:keys.WarehouseMovementValuation.ids},actorId:ids.actor,movementId:{in:movementIds}}});
   await tx.warehouseBalance.delete({where:{materialId:ids.material}});
   await tx.stockMovement.deleteMany({where:{id:{in:movementIds},createdById:ids.actor,materialId:ids.material}});
   await tx.projectMaterial.delete({where:{id:ids.line}});await tx.material.delete({where:{id:ids.material}});
   await tx.product.delete({where:{id:ids.product}});await tx.project.delete({where:{id:ids.project}});
   await tx.client.delete({where:{id:ids.client}});await tx.user.delete({where:{id:ids.actor}});
   assert.deepEqual(await nativeSnapshot(tx),before,'ORIGINAL_CHANGED_INSIDE_CLEANUP');
  },{isolationLevel:'Serializable',timeout:60000,maxWait:10000});
  const after=await nativeSnapshot(db);assert.deepEqual(after,before,'ORIGINAL_CHANGED_AFTER_CLEANUP');
  await save('warehouse.cleanup-verified',{phase:'CLEANUP_VERIFIED',planSha256:input.planSha256,afterDigest:after.digest});cleanupVerified=true;
  return {status:'PASS',level:'native-PostgreSQL',revision:input.revision,target:input.target,runId:input.runId,scenarioId:input.scenarioId,producerId:'warehouse-concurrency',producerVersion:2,identity:binding.identity,
   checks:['independent-connections','issue-no-negative','duplicate-one-mutation','concurrent-return','all-fk-original-before-cleanup','original-state-data'].map(id=>({id,status:'PASS'})),
   preservation:{mode:'owned-cleanup',status:'PASS',cleanup:'VERIFIED',beforeDigest:before.digest,afterDigest:after.digest},backendConnections:backendPids.size,planSha256:input.planSha256,outerPreparationReceiptSha256:input.outerPreparationReceiptSha256};
 } catch(error) {failure=error;hasFailure=true;throw error;}
 finally {
  await db.$disconnect();await other.$disconnect();
  if(writesStarted&&!cleanupVerified)throw new AggregateError(hasFailure?[failure]:[],'NATIVE_OWNED_GRAPH_HOLD_INSPECT_REQUIRED');
 }
}
const direct=process.argv[1]&&path.basename(process.argv[1])==="warehouse-concurrency-native.ts"&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct) {
 const [operation,target,revision,runId,scenarioId,preFile]=process.argv.slice(2);
 void(async()=>{
  assert.ok(target==='local'||target==='staging','EXPLICIT_NATIVE_TARGET_REQUIRED');
  if(operation==='inspect')return inspectWarehouseConcurrencyAcceptance({target,revision,runId,scenarioId,nativeScenarioId:preFile});
  assert.equal(operation,'run','EXPLICIT_NATIVE_OPERATION_REQUIRED');
  const pre=JSON.parse(await readFile(preFile,'utf8')) as {plan:WarehousePlan;planSha256:string;outerPreparationReceiptSha256:string};
  return runWarehouseConcurrencyAcceptance({target,revision,runId,scenarioId,...pre});
 })().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error(JSON.stringify({status:'BLOCKED',code:'NATIVE_ACCEPTANCE_HOLD'}));process.exitCode=1;});
}
