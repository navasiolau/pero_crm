// Instrumented real-core PostgreSQL probes; root executes only after target guards.
// Every owned fixture and audit/outbox row is inside one outer transaction which aborts.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {patchProductCore,updateProductCore} from '../src/server/products/core.ts';
import {createTaskTransaction} from '../src/server/tasks/transaction.ts';
import {updateProjectCore} from '../src/server/projects/core.ts';
let phase='target_guard';
const TABLES=['User','Client','Project','Product','Task','Work','File','Payment','Payout','PayrollEntry','Material','ProjectMaterial','StockMovement','ChangeLog','TimeEntry','DomainEvent'];
function guard(){
 const target=process.env.CRM_MODERNIZATION_TARGET;const url=new URL(process.env.DATABASE_URL??'');
 assert.equal(url.protocol,'postgresql:');assert.ok(!url.hash);assert.ok(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public');
 if(target==='local'){assert.equal(process.platform,'win32');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');}
 else if(target==='staging'){
  assert.ok(existsSync('/.dockerenv')&&/^[a-f0-9]{12,64}$/.test(hostname()));assert.equal(url.hostname,'db');assert.equal(url.port||'5432','5432');assert.equal(url.pathname,'/crm');assert.equal(process.env.S3_BUCKET,'pero-crm-staging');
  const proof=JSON.parse(process.env.CRM_MODERNIZATION_STAGE_PROOF??'');assert.equal(proof.hostname,'crm-staging');assert.match(proof.revision,/^[a-f0-9]{40}$/);assert.equal(proof.databaseVolume,'crm-staging_pgdata');assert.match(proof.outerW07Sha256,/^[a-f0-9]{64}$/);assert.ok(proof.web&&proof.database);
 }else throw new Error('EXPLICIT_LOCAL_OR_STAGING_TARGET_REQUIRED');return target;
}
async function fingerprint(db){const result={};for(const table of TABLES){const [row]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${table}" t`);result[table]=row;}return result;}
async function main(){
 const target=guard();const db=new PrismaClient({log:[{emit:'event',level:'query'}]});const queryProfiles=[];let activeProfile=null;
 db.$on('query',event=>{if(activeProfile)activeProfile.queries.push(event.query)});
 async function profiled(label,allowedTables,operation){
  const capture={queries:[],fetchCalls:0};const originalFetch=globalThis.fetch;
  requireThatNoOverlap();activeProfile=capture;globalThis.fetch=async()=>{capture.fetchCalls++;throw new Error('NATIVE_FIELD_EXTERNAL_FETCH_FORBIDDEN')};
  try{const result=await operation();await new Promise(resolve=>setImmediate(resolve));
   assert.ok(capture.queries.length>0,'PRISMA_QUERY_EVENTS_REQUIRED');const counts={};
   for(const query of capture.queries){const tables=[...query.matchAll(/(?:FROM|JOIN|UPDATE|INTO)\s+(?:"[^"]+"\.)?"([^"]+)"/gi)].map(match=>match[1]);for(const table of tables){assert.ok(allowedTables.includes(table),`UNEXPECTED_FIELD_QUERY_TABLE_${table}`);counts[table]=(counts[table]??0)+1;}assert.ok(!/row_to_json|string_agg|pg_tables/i.test(query),'FULL_SNAPSHOT_OR_TABLE_SCAN_FORBIDDEN');}
   assert.ok(counts.Product>0&&counts.ChangeLog>0,'PRODUCT_AND_RECEIPT_SQL_REQUIRED');if(label==='manager_shared_phone_scalar_CAS')assert.ok(counts.Project>0&&counts.Client>0&&counts.DomainEvent>0,'SHARED_PHONE_CAS_AUDIT_OUTBOX_SQL_REQUIRED');assert.equal(capture.fetchCalls,0,'EXTERNAL_FETCH_ATTEMPTED');queryProfiles.push({label,queryCount:capture.queries.length,tables:Object.keys(counts).sort(),tableQueryCounts:counts,sqlShapeSha256:createHash('sha256').update(capture.queries.join('\n')).digest('hex'),noExternalFetch:true});return result;
  }finally{activeProfile=null;globalThis.fetch=originalFetch;}
 }
 function requireThatNoOverlap(){assert.equal(activeProfile,null,'QUERY_PROFILE_OVERLAP_FORBIDDEN')}
 const checks=[];const rollback=new Error('EXPECTED_PRODUCT_INLINE_NATIVE_ROLLBACK');
 try{
  phase='initial_fingerprint';const before=await fingerprint(db);
  await assert.rejects(db.$transaction(async tx=>{
   globalThis.__crmInlineTx=tx;await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
   const [identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name, current_schema() AS schema');assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
   let savepoint=0;
   const operationDatabase={$transaction:async operation=>{const name=`inline_probe_${++savepoint}`;await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);try{const value=await operation(tx);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);return value;}catch(error){await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);throw error;}}};
   const transaction=createTaskTransaction(operationDatabase);globalThis.__crmInlineTransaction=operationDatabase.$transaction;
   // Invalid non-credential sentinel satisfies mandatory passwordHash, cannot log in.
   // All actors are unique owned rows, never changes to existing users/roles.
   const marker=randomUUID();const actor=async roles=>tx.user.create({data:{id:randomUUID(),email:`qa-inline-${randomUUID()}@invalid.test`,name:`QA inline ${marker}`,passwordHash:'QA_DISABLED_NOT_A_PASSWORD_HASH',roles,active:true},select:{id:true,name:true,roles:true}});
   phase='owned_fixtures';const manager={...await actor(['MANAGER']),source:'api'};const second={...await actor(['MANAGER']),source:'api'};const engineer={...await actor(['ENGINEER']),source:'api'};const combined={...await actor(['MANAGER','ENGINEER']),source:'api'};const accountantEngineer={...await actor(['ENGINEER','ACCOUNTANT']),source:'api'};
   const client=await tx.client.create({data:{id:randomUUID(),name:`QA ${marker}`,phone:'100'}});const otherClient=await tx.client.create({data:{id:randomUUID(),name:`QA other ${marker}`,phone:'999'}});
   const max=await tx.project.aggregate({_max:{numberInt:true}});const numberInt=(max._max.numberInt??0)+1;
   const project=await tx.project.create({data:{id:randomUUID(),number:String(numberInt),numberInt,title:`QA ${marker}`,currency:'BYN',clientId:client.id,address:null}});
   const product=await tx.product.create({data:{id:randomUUID(),projectId:project.id,number:`${project.number}.1`,suffixInt:1,title:'Original',quantity:1,expectedPrice:'10.01',engineerId:engineer.id,description:'Tech',status:'DESIGN'}});
   const sibling=await tx.product.create({data:{id:randomUUID(),projectId:project.id,number:`${project.number}.2`,suffixInt:2,title:'Sibling',quantity:1,engineerId:engineer.id,status:'DESIGN'}});
   const normWork=await tx.work.create({data:{id:randomUUID(),projectId:project.id,productId:product.id,title:'QA norm',quantity:'1.00',quantityPerUnit:'1.00',priceSnapshot:'0.10',total:'0.10'}});
   const legacyContactBaseline={address:null,clientId:client.id};
   const patch=(field,value,expectedValue,extra={})=>({productId:product.id,field,value,expectedValue,clientMutationId:randomUUID(),...extra});
   const apply=(user,input)=>patchProductCore(user,input,transaction);
   phase='CAS';const titlePatch=patch('title','First','Original');assert.equal((await profiled('manager_title_scalar_CAS',['Product','ChangeLog','User'],()=>apply(manager,titlePatch))).kind,'saved');assert.equal((await apply(second,patch('title','Second','Original'))).kind,'conflict');assert.equal((await apply(second,patch('kind','Cabinet',null))).kind,'saved');checks.push('same_field_two_actor_CAS_and_different_fields');
   phase='noop_replay';const logs=await tx.changeLog.count();const events=await tx.domainEvent.count();const noop=await apply(manager,patch('title','First','First'));assert.equal(noop.kind,'saved');assert.equal(noop.noOp,true);assert.equal(await tx.changeLog.count(),logs);assert.equal(await tx.domainEvent.count(),events);assert.equal((await apply(manager,titlePatch)).repeated,true);assert.equal(await tx.changeLog.count(),logs);assert.equal((await apply(manager,{...titlePatch,value:'Reuse'})).kind,'validation');checks.push('noop_no_audit_outbox_replay_and_reused_ID');
   phase='shared_contacts';assert.equal((await apply(manager,patch('project.address',' Shared ',null))).kind,'saved');const addr=await apply(second,patch('project.address','Other',null,{productId:sibling.id}));assert.equal(addr.kind,'conflict');assert.equal(addr.currentValue,'Shared');
   assert.equal((await apply(manager,patch('client.phone',' ', '100',{expectedClientId:client.id}))).kind,'validation');assert.equal((await profiled('manager_shared_phone_scalar_CAS',['Product','Project','Client','ChangeLog','DomainEvent','User'],()=>apply(manager,patch('client.phone','200','100',{expectedClientId:client.id})))).kind,'saved');assert.equal((await apply(manager,patch('client.phone','300','100',{productId:sibling.id,expectedClientId:client.id}))).kind,'conflict');
   assert.equal((await apply(manager,patch('project.clientId',otherClient.id,client.id))).kind,'saved');const oldPhone=await apply(second,patch('client.phone','400','200',{expectedClientId:client.id}));assert.equal(oldPhone.kind,'conflict');assert.equal(oldPhone.currentClientId,otherClient.id);assert.equal((await tx.client.findUnique({where:{id:client.id}})).phone,'200');assert.equal((await tx.client.findUnique({where:{id:otherClient.id}})).phone,'999');checks.push('shared_contacts_required_phone_client_switch_CAS');
   phase='legacy_project_contacts';
   const legacyTitle=await updateProjectCore(manager,project.id,{title:'Legacy title only',address:legacyContactBaseline.address,clientId:legacyContactBaseline.clientId,contactBaseline:legacyContactBaseline});
   assert.equal(legacyTitle.ok,true);const retained=await tx.project.findUnique({where:{id:project.id},select:{title:true,address:true,clientId:true}});assert.deepEqual(retained,{title:'Legacy title only',address:'Shared',clientId:otherClient.id});
   const legacyBefore=await fingerprint(tx);const staleAddress=await updateProjectCore(second,project.id,{title:'Rejected title',address:'Stale replacement',contactBaseline:legacyContactBaseline});assert.equal(staleAddress.ok,false);assert.deepEqual(await fingerprint(tx),legacyBefore);
   const rejectedClient=await updateProjectCore(second,project.id,{title:'Must not commit',clientId:otherClient.id,contactBaseline:legacyContactBaseline});assert.equal(rejectedClient.ok,false);assert.deepEqual(await fingerprint(tx),legacyBefore);
   checks.push('legacy_project_true_baseline_title_only_preserves_contacts_changed_stale_contacts_atomic_reject');

   phase='Decimal_quantity';assert.equal((await apply(manager,patch('expectedPrice','0','10.01'))).kind,'saved');assert.equal((await apply(manager,patch('expectedPrice',null,'0'))).kind,'saved');assert.equal((await apply(manager,patch('expectedPrice','0.10',null))).kind,'saved');const qty=await apply(manager,patch('quantity',3,1));assert.equal(qty.kind,'saved');assert.equal(qty.derived.lineTotalBYN,'0.30');assert.equal((await apply(manager,patch('quantity',1.5,3))).kind,'validation');const overflow=await apply(manager,patch('expectedPrice','9999999999.99','0.10'));assert.notEqual(overflow.kind,'saved');assert.equal((await tx.product.findUnique({where:{id:product.id}})).expectedPrice.toFixed(2),'0.10');assert.equal((await tx.work.findUnique({where:{id:normWork.id}})).quantity.toFixed(2),'3.00');
   const ownedTask=await tx.task.create({data:{id:randomUUID(),projectId:project.id,productId:product.id,workId:normWork.id,title:'QA allocated',quantity:'2.00'}});const allocationBefore=await fingerprint(tx);assert.notEqual((await apply(manager,patch('quantity',1,3))).kind,'saved');assert.deepEqual(await fingerprint(tx),allocationBefore);
   await tx.task.update({where:{id:ownedTask.id},data:{quantity:'1.00'}});const material=await tx.material.create({data:{id:randomUUID(),name:'QA material'}});await tx.projectMaterial.create({data:{id:randomUUID(),productId:product.id,materialId:material.id,quantity:'3.000',quantityPerUnit:'1.000',issuedQty:'2.000'}});const issuedBefore=await fingerprint(tx);assert.notEqual((await apply(manager,patch('quantity',1,3))).kind,'saved');assert.deepEqual(await fingerprint(tx),issuedBefore);checks.push('zero_null_decimal_line_quantity_norm_allocated_issued_guards');
   phase='roles';assert.equal((await apply(engineer,patch('description','New tech','Tech'))).kind,'saved');assert.equal((await apply(accountantEngineer,patch('description','Hidden','New tech'))).kind,'not-found');assert.equal((await apply(combined,patch('title','Combined','First'))).kind,'saved');await tx.product.update({where:{id:product.id},data:{status:'PRODUCTION'}});const revoked=await apply(engineer,patch('description','Stale','New tech'));assert.ok(['forbidden','not-found'].includes(revoked.kind));assert.equal(revoked.currentValue,undefined);checks.push('assigned_engineer_DESIGN_union_roles_then_revoked');
   phase='legacy_full_form';assert.equal((await updateProductCore(manager,product.id,{title:'Bypass'},undefined,transaction)).ok,false);checks.push('stale_full_form_rejected');
   phase='atomic_failure';const atomicBefore=await fingerprint(tx);const failing=createTaskTransaction({$transaction:async operation=>{const name=`inline_fail_${++savepoint}`;await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);const injected=new Proxy(tx,{get(target,key){if(key==='domainEvent')return new Proxy(target.domainEvent,{get(model,method){if(method==='create')return async()=>{throw new Error('QA_OUTBOX_FAILURE')};return model[method]}});return target[key]}});try{const result=await operation(injected);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);throw error;}}});
   const failed=await patchProductCore(manager,patch('project.address','Atomic','Shared'),failing);assert.equal(failed.kind,'failure');assert.deepEqual(await fingerprint(tx),atomicBefore);checks.push('real_postgres_savepoint_audit_outbox_rollback');
   throw rollback;
  },{timeout:120000,maxWait:10000,isolationLevel:'ReadCommitted'}),error=>error===rollback);
  phase='rollback_fingerprint';assert.equal(queryProfiles.length,2);checks.push('actual_Prisma_SQL_title_phone_bounded_no_history_economics_external_fetch');assert.deepEqual(await fingerprint(db),before);
  console.log(JSON.stringify({kind:'product-inline-native-acceptance',target,checks,queryProfiles,rollbackVerified:true,tables:before,scope:'real domain cores and PostgreSQL; nested transaction boundary uses real savepoints; outer rollback; delivery/cache stubbed; no browser proof'}));
 }finally{delete globalThis.__crmInlineTx;delete globalThis.__crmInlineTransaction;await db.$disconnect();}
}
try{await main();}catch{console.log(JSON.stringify({kind:'product-inline-native-acceptance',status:'FAIL',phase}));process.exitCode=1;}
