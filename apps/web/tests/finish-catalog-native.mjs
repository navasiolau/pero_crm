import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {guard} from './product-attachments-native.mjs';
import {fingerprintFinishCatalogDatabase as fingerprint} from './finish-catalog-native-fingerprint.mjs';
import {createFinishCore,updateFinishCore,setFinishActiveCore} from '../src/server/finishes/core.ts';
import {listFinishesFor} from '../src/server/finishes/queries.ts';
import {canManageFinishCatalog} from '../src/lib/finish-catalog-access.ts';
let phase='guard';
async function main(){
 const target=guard(),db=new PrismaClient(),checks=[],rollback=Error('EXPECTED_FINISH_CATALOG_ROLLBACK');let externalFetchCalls=0;const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{externalFetchCalls++;throw Error('NATIVE_EXTERNAL_FETCH_FORBIDDEN')};
 try{
  const before=await fingerprint(db);
  await assert.rejects(db.$transaction(async tx=>{
   globalThis.__finishNativeTx=tx;let serial=0;
   const boundary=async fn=>{const savepoint=`finish72_${++serial}`;await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);try{const value=await fn(tx);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);return value;}catch(error){await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);throw error;}};
   globalThis.__finishNativeBoundary=boundary;
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
   const[identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name,current_schema() AS schema');assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
   const users=await tx.user.findMany({where:{active:true},select:{id:true,name:true,roles:true}}),manager=users.find(row=>canManageFinishCatalog(row.roles)),readonly=users.find(row=>!canManageFinishCatalog(row.roles)&&row.roles.some(role=>['ENGINEER','WORKER','MOUNTER','ACCOUNTANT'].includes(role)));assert.ok(manager&&readonly);
   const actor={...manager,source:'web'},reader={...readonly,source:'web'},marker=randomUUID(),fields={kind:'ENAMEL',name:'QA finish '+marker,code:'QA72-'+marker,color:'Белый'};
   phase='create';const created=await createFinishCore(actor,fields,boundary);assert.equal(created.ok,true);checks.push('real_create_UUID_canonical_code_audit');
   phase='duplicate';const duplicateBefore=await fingerprint(tx);const duplicate=await createFinishCore(actor,{...fields,code:fields.code.toLowerCase()},boundary);assert.equal(duplicate.ok,false);assert.equal(duplicate.kind,'validation');assert.deepEqual(await fingerprint(tx),duplicateBefore);checks.push('same_kind_code_duplicate_no_second_row_or_audit');
   phase='cas';const updated=await updateFinishCore(actor,{...fields,name:'QA edited '+marker,id:created.row.id,expectedRevision:created.row.revision},boundary);assert.equal(updated.ok,true);const staleBefore=await fingerprint(tx);assert.equal((await updateFinishCore(actor,{...fields,id:created.row.id,expectedRevision:created.row.revision},boundary)).ok,false);assert.deepEqual(await fingerprint(tx),staleBefore);checks.push('real_editor_CAS_stale_no_changes');
   phase='activity';const disabled=await setFinishActiveCore(actor,{id:created.row.id,active:false,expectedRevision:updated.row.revision},boundary);assert.equal(disabled.ok,true);assert.equal((await tx.finish.findUnique({where:{id:created.row.id}})).active,false);assert.equal((await listFinishesFor(actor,tx)).some(row=>row.id===created.row.id),true);
   if(reader.roles.some(role=>['ENGINEER','WORKER','MOUNTER','PROCUREMENT'].includes(role)))assert.equal((await listFinishesFor(reader,tx)).some(row=>row.id===created.row.id),false);
   assert.equal((await setFinishActiveCore(actor,{id:created.row.id,active:true,expectedRevision:disabled.row.revision},boundary)).ok,true);checks.push('deactivate_reactivate_same_ID_no_delete');
   phase='acl';const deniedBefore=await fingerprint(tx);assert.equal((await createFinishCore(reader,fields,boundary)).kind,'forbidden');assert.deepEqual(await fingerprint(tx),deniedBefore);checks.push('existing_readonly_actor_denied_no_data_changes');
   phase='audit';const auditBefore=await fingerprint(tx);const broken=new Proxy(tx,{get(target,key){if(key==='changeLog')return{...target.changeLog,create:async()=>{throw Error('QA_FINISH_AUDIT_FAILURE')}};return Reflect.get(target,key)}});const failed=await createFinishCore(actor,{...fields,code:'QA72-fail-'+marker},fn=>boundary(()=>fn(broken)));assert.equal(failed.ok,false);assert.deepEqual(await fingerprint(tx),auditBefore);checks.push('audit_failure_rolls_back_finish_and_all_original_tables');
   throw rollback;
  },{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000}),error=>error===rollback);
  assert.deepEqual(await fingerprint(db),before);assert.equal(externalFetchCalls,0);
  console.log(JSON.stringify({kind:'finish-catalog-native',target,checks,rollbackVerified:true,migration:'20261003090000_finish_catalog',capturedTableCount:Object.keys(before.tables).length,tables:before.tables,schema:before.schema,externalFetchCalls,fingerprintProfile:'dynamic-public-tables-and-schema-ApiToken.lastUsedAt-only-operational-v3',scope:'real instrumented Finish cores + PostgreSQL; no hosted UI, storage, Product assignments or money changes'}));
 }finally{delete globalThis.__finishNativeTx;delete globalThis.__finishNativeBoundary;globalThis.fetch=originalFetch;await db.$disconnect();}
}
try{await main();}catch{console.log(JSON.stringify({kind:'finish-catalog-native',status:'FAIL',phase}));process.exitCode=1;}
