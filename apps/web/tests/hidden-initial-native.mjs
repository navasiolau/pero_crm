// Build-only source-worker artifact. Root rebuilds integrated source and runs after marker migration.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {guard,fingerprint} from './product-attachments-native.mjs';
import {createTaskTransaction} from '../src/server/tasks/transaction.ts';
import {createProductCore,patchProductCore,updateProductCore} from '../src/server/products/core.ts';
import {createProjectCore} from '../src/server/projects/core.ts';
import {updateProjectFieldsCore,patchProjectCore} from '../src/server/projects/project-field-core.ts';
let phase='guard';
async function main(){
 const target=guard(),db=new PrismaClient(),checks=[],rollback=Error('EXPECTED_INITIAL_OUTER_ROLLBACK');
 const originalFetch=globalThis.fetch;let externalFetchCalls=0;globalThis.fetch=async()=>{externalFetchCalls++;throw Error('NATIVE_EXTERNAL_FETCH_FORBIDDEN');};
 try{const before=await fingerprint(db);await assert.rejects(db.$transaction(async tx=>{
  globalThis.__crmInitialTx=tx;let serial=0;
  const boundary=async(fn,inject)=>{const name=`initial_${++serial}`;await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);try{const value=await fn(inject??tx);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);return value;}catch(error){await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);throw error;}};
  globalThis.__crmInitialTransaction=fn=>boundary(fn);
  const transaction=createTaskTransaction({$transaction:fn=>boundary(fn)});
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
  const [identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name,current_schema() AS schema');assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
  const marker=randomUUID(),manager=await tx.user.create({data:{id:randomUUID(),name:'QA initial '+marker,email:marker+'@invalid.test',passwordHash:'QA_DISABLED_NOT_A_PASSWORD_HASH',roles:['MANAGER'],active:true}}),actor={id:manager.id,name:manager.name,roles:manager.roles,source:'api'};
  const client=await tx.client.create({data:{id:randomUUID(),name:'QA initial '+marker,phone:'100'}});
  const createdProject=await createProjectCore(actor,{title:'QA initial '+marker,clientId:client.id});assert.equal(createdProject.ok,true);const projectId=createdProject.id;assert.equal((await tx.project.findUnique({where:{id:projectId}})).initialPrice,null);
  const make=async(expectedPrice)=>{const result=await createProductCore(actor,{projectId,title:'QA initial product',quantity:3,...(expectedPrice===undefined?{}:{expectedPrice})},transaction);assert.equal(result.ok,true);return result.product;};
  const read=p=>tx.product.findUnique({where:{id:p.id}});
  const patch=(p,value,expectedValue)=>({productId:p.id,field:'expectedPrice',value,expectedValue,clientMutationId:randomUUID()});

  phase='create_zero';const zero=await make(0);assert.equal(zero.initialPrice.toFixed(2),'0.00');assert.equal(zero.initialPriceCaptureEligible,false);const positive=await make(12.34);assert.equal(positive.initialPrice.toFixed(2),'12.34');assert.equal(positive.initialPriceCaptureEligible,false);assert.equal((await tx.project.findUnique({where:{id:projectId}})).initialPrice,null);checks.push('real_new_create_zero_positive_unit_snapshot_project_NULL_no_sum');

  phase='first_price_replay';for(const first of ['0','12.34']){const p=await make();assert.equal(p.initialPrice,null);assert.equal(p.initialPriceCaptureEligible,true);const input=patch(p,first,null);assert.equal((await patchProductCore(actor,input,transaction)).kind,'saved');const captured=await read(p);assert.equal(captured.initialPrice.toFixed(2),Number(first).toFixed(2));assert.equal(captured.initialPriceCaptureEligible,false);const once=await fingerprint(tx);const replay=await patchProductCore(actor,input,transaction);assert.equal(replay.kind,'saved');assert.equal(replay.repeated,true);assert.deepEqual(await fingerprint(tx),once);assert.equal((await patchProductCore(actor,patch(p,'200',Number(first).toFixed(2)),transaction)).kind,'saved');assert.equal((await patchProductCore(actor,patch(p,null,'200.00'),transaction)).kind,'saved');assert.equal((await updateProductCore(actor,p.id,{quantity:4},{quantity:3},transaction)).ok,true);assert.equal((await read(p)).initialPrice.toFixed(2),captured.initialPrice.toFixed(2));assert.equal((await read(p)).initialPriceCaptureEligible,false);}checks.push('delayed_first_zero_positive_inline_receipt_replay_later_price_null_quantity_frozen');

  phase='legacy_rows';const parent=await tx.project.findUnique({where:{id:projectId}});let suffix=1000;for(const initialPrice of [null,'99.00']){const p=await tx.product.create({data:{id:randomUUID(),projectId,number:parent.number+'.'+(++suffix),suffixInt:suffix,title:'QA historical',quantity:1,expectedPrice:null,initialPrice}});assert.equal(p.initialPriceCaptureEligible,false);assert.equal((await updateProductCore(actor,p.id,{expectedPrice:50},{expectedPrice:null},transaction)).ok,true);assert.equal((await read(p)).initialPrice?.toFixed(2)??null,initialPrice);}checks.push('SQL_default_false_legacy_NULL_never_capture_existing_snapshot_immutable');

  phase='CAS_and_audit_rollback';const pending=await make();const staleBefore=await fingerprint(tx);const stale=await patchProductCore(actor,patch(pending,'12.34','1.00'),transaction);assert.equal(stale.kind,'conflict');assert.deepEqual(await fingerprint(tx),staleBefore);
  const injected=new Proxy(tx,{get(target,key){if(key==='changeLog')return new Proxy(target.changeLog,{get(model,method){if(method==='create')return async()=>{throw Error('QA_INITIAL_AUDIT_FAILURE')};return model[method]}});return target[key]}}),failing=createTaskTransaction({$transaction:fn=>boundary(fn,injected)});
  const failed=await patchProductCore(actor,patch(pending,'12.34',null),failing);assert.equal(failed.kind,'failure');assert.deepEqual(await fingerprint(tx),staleBefore);const state=await read(pending);assert.equal(state.initialPrice,null);assert.equal(state.expectedPrice,null);assert.equal(state.initialPriceCaptureEligible,true);assert.equal((await updateProductCore(actor,pending.id,{expectedPrice:12.34},{expectedPrice:null},transaction)).ok,true);assert.equal((await read(pending)).initialPrice.toFixed(2),'12.34');checks.push('actual_stale_CAS_no_write_audit_failure_SQL_savepoint_rolls_marker_snapshot_price_audit_back');

  phase='strict_ordinary_DTO';const rejectedBefore=await fingerprint(tx);
  assert.equal((await createProductCore(actor,{projectId,title:'forbidden',initialPrice:0},transaction)).ok,false);
  assert.equal((await updateProductCore(actor,zero.id,{initialPrice:0},{initialPrice:'0.00'},transaction)).ok,false);
  assert.equal((await patchProductCore(actor,{...patch(zero,'1','0.00'),initialPrice:0},transaction)).kind,'validation');
  assert.equal((await patchProductCore(actor,{...patch(zero,'1','0.00'),field:'initialPrice'},transaction)).kind,'validation');
  assert.equal((await createProjectCore(actor,{title:'forbidden',clientId:client.id,initialPrice:0})).ok,false);
  assert.equal((await updateProjectFieldsCore(actor,projectId,{initialPrice:0,baseline:{initialPrice:null}},transaction)).ok,false);
  assert.equal((await patchProjectCore(actor,{projectId,field:'initialPrice',value:'0',expectedValue:null,clientMutationId:randomUUID()},transaction)).kind,'validation');
  assert.deepEqual(await fingerprint(tx),rejectedBefore);checks.push('actual_Product_Project_create_full_inline_forbidden_initialPrice_rejected_without_DB_writes');
  assert.equal(await tx.payrollEntry.count({where:{projectId}}),0);assert.equal(await tx.work.count({where:{projectId}}),0);assert.equal(await tx.task.count({where:{projectId}}),0);
  throw rollback;
 },{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000}),error=>error===rollback);
 assert.deepEqual(await fingerprint(db),before);assert.equal(externalFetchCalls,0);
 console.log(JSON.stringify({kind:'hidden-initial-native',target,checks,externalFetchCalls,rollbackVerified:true,capturedTableCount:Object.keys(before).length,fingerprintProfile:'all-models-and-migrations-ApiToken.lastUsedAt-only-operational-v2',tables:before,scope:'actual Prisma/core/CAS/audit with sequential savepoints and outer rollback; no hosted concurrency claim'}));
 }finally{globalThis.fetch=originalFetch;delete globalThis.__crmInitialTx;delete globalThis.__crmInitialTransaction;await db.$disconnect();}
}
try{await main();}catch{console.log(JSON.stringify({kind:'hidden-initial-native',status:'FAIL',phase}));process.exitCode=1;}
