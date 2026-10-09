// Root-only existing LOCAL prerequisite. All own DB writes are inside one outer ROLLBACK.
// Actual graph creator/SELECT/locks/delete helpers are shared with the producer, not simulated copies.
// No migrations, files, HTTP, S3, auth cookies, original financial/stock/payroll writes or dumps.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on mismatch.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {newFixturePlan,digest} from './file-fixture113-protocol.mjs';
import {createOwnGraph,ownState,lockOwned,deleteOwnedRows} from './file-fixture113-entry.mjs';
let phase='guard';
export function lifecycleNativeGuard(env=process.env,platform=process.platform){
 assert.equal(env.CRM_MODERNIZATION_TARGET,'local');assert.equal(platform,'win32');
 const url=new URL(env.DATABASE_URL??'');assert.equal(url.protocol,'postgresql:');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');assert.equal(url.hash,'');
 const allowed=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);assert.ok([...url.searchParams.keys()].every(key=>allowed.has(key)&&url.searchParams.getAll(key).length===1));assert.ok(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public');return true;
}
const fpSql=query=>"SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') hash FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h FROM ("+query+") r) q";
async function snapshots(tx){
 const[identity]=await tx.$queryRawUnsafe('SELECT current_database()::text name,current_schema()::text schema,NOT pg_is_in_recovery() AS "primary"');assert.deepEqual(identity,{name:'pero_crm',schema:'public',primary:true});
 const names=(await tx.$queryRawUnsafe("SELECT tablename::text name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.name);assert.ok(names.length>30&&names.length<150);
 const data={};for(const name of names){assert.match(name,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);const[fp]=await tx.$queryRawUnsafe(fpSql('SELECT t.* FROM "'+name+'" t'));data[name]=fp;}
 const schema={};for(const[key,sql]of Object.entries({
  columns:"SELECT * FROM information_schema.columns WHERE table_schema='public'",
  constraints:"SELECT t.relname,c.conname,c.contype,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'",
  indexes:"SELECT * FROM pg_indexes WHERE schemaname='public'",
  triggers:"SELECT t.relname,c.tgname,c.tgenabled,pg_get_triggerdef(c.oid,true) definition FROM pg_trigger c JOIN pg_class t ON t.oid=c.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'",
  types:"SELECT t.* FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'",
 })){const[fp]=await tx.$queryRawUnsafe(fpSql(sql));schema[key]=fp;}
 return {names,data,schema};
}
async function readonly(db,fn){return db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return fn(tx);},{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});}
export async function lifecycleRollback(db){
 phase='baseline-readonly';
 const before=await readonly(db,snapshots),rollback=Error('EXPECTED_NATIVE113_LIFECYCLE_ROLLBACK'),checks=[],cases=[];let failure,failurePhase;
 try{await db.$transaction(async tx=>{
  phase='advisory-lock';await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');assert.deepEqual(await snapshots(tx),before);
  phase='actual-preference-schema';const constraints=await tx.$queryRawUnsafe("SELECT c.contype::text kind,pg_get_constraintdef(c.oid,true)::text definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=$1",'UserPreference');
  assert.equal(constraints.filter(row=>row.kind==='f').length,0);assert.ok(constraints.some(row=>row.kind==='p'&&row.definition==='PRIMARY KEY ("userId", key)'));
  for(const preferenceCount of [0,2]){
   phase='fresh-owned-plan';const p=newFixturePlan(randomUUID(),'a'.repeat(40));p.numberInt=((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1;p.projectNumber=String(p.numberInt);p.productNumber=p.projectNumber+'.1';p.taskTitle='QA113 files '+p.runId;p.articleCode=((await tx.expenseArticle.aggregate({_max:{code:true}}))._max.code??0)+1;
   const actors=Object.values(p.actors).map(row=>row.id),controlUser=randomUUID(),controlKey='qa113.native-control.'+p.runId,controlValue='PERO113_OWN_NOFK_CONTROL';
   assert.equal(await tx.user.count({where:{id:{in:[...actors,controlUser]}}}),0);assert.equal(await tx.userPreference.count({where:{userId:{in:[...actors,controlUser]}}}),0);
   phase='actual-shared-creator';await createOwnGraph(tx,p);
   phase='control-preference';await tx.userPreference.create({data:{userId:controlUser,key:controlKey,value:controlValue}});
   if(preferenceCount)for(const[actor,key]of [[p.actors.engineer.id,'product.tab'],[p.actors.manager.id,'project.tab']])await tx.userPreference.create({data:{userId:actor,key,value:'files'}});
   phase='actual-composite-selector';const state=await ownState(tx,{plan:p});assert.equal(state.rows.UserPreference.length,preferenceCount);assert.equal(state.scope.UserPreference.length,preferenceCount);assert.ok(state.scope.UserPreference.every(row=>Object.keys(row).sort().join('|')==='key|userId'));
   assert.ok(state.rows.Payment.every(row=>typeof row.paidAt==='string'&&row.paidAt.slice(0,10)===p.financeDate&&!Object.hasOwn(row,'date')));assert.equal(state.rows.Payment.length,2);
   phase='actual-own-locks';await lockOwned(tx,state);const locked=await ownState(tx,{plan:p});assert.equal(digest(locked.rows),digest(state.rows));
   phase='actual-shared-cleanup';const counts=await deleteOwnedRows(tx,state);assert.equal(counts.UserPreference,preferenceCount);assert.equal(counts.User,3);assert.equal(counts.Payment,2);assert.equal(counts.Task,1);assert.equal(counts.Product,1);assert.equal(counts.Project,1);assert.equal(counts.CashAccount,1);assert.equal(counts.ExpenseArticle,1);assert.equal(counts.Client,1);
   phase='exact-control-preserved';assert.deepEqual(await tx.userPreference.findUnique({where:{userId_key:{userId:controlUser,key:controlKey}}}),{userId:controlUser,key:controlKey,value:controlValue});assert.equal(await tx.userPreference.count({where:{userId:{in:actors}}}),0);assert.equal(await tx.user.count({where:{id:{in:actors}}}),0);
   assert.equal((await tx.userPreference.deleteMany({where:{userId:controlUser,key:controlKey,value:controlValue}})).count,1);
   phase='inside-cleanup-original-proof';assert.deepEqual(await snapshots(tx),before);cases.push({preferenceCount,creatorRows:11,preferencesDeleted:counts.UserPreference,actorsDeleted:counts.User,ownControlPreserved:true,allOriginalDataSchemaRestored:true});
  }
  checks.push('actual shared creator accepts real Prisma fields including Payment.paidAt','actual UserPreference composite PK and noFK verified','actual zero/nonempty shared SELECT/order/scope/locks/exactpairdelete complete','fresh distinct noFK control preference survives both own cleanup cycles','ALL original public tables inclfinancial/api/migrationledger and schema MATCH inside both cleanups');
  phase='expected-outer-rollback';throw rollback;
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});}catch(error){if(error!==rollback){failure=error;failurePhase=phase;}}
 phase='after-outer-rollback-proof';const after=await readonly(db,snapshots),restored=digest(before)===digest(after);if(!restored)throw Error('NATIVE_ORIGINAL_DATA_SCHEMA_RESTORE_MISMATCH');
 if(failure){failure.nativeRollbackRestored=true;phase=failurePhase;throw failure;}
 return {kind:'file-fixture113-lifecycle-native',status:'PASS',existingPublicTables:before.names.length,cases,checks,rollbackVerified:true,allOriginalDataSchemaRestored:true,originalFinancialFactsPreserved:true,actualSharedProducerMethods:true,actualCompositePreferenceSchema:true,metadataOnly:true,httpExecuted:false,s3Executed:false,storageWrites:0,migrationsApplied:false,stageExecuted:false,wholeProducerEndToEndProven:false};
}
function safeFailure(error){let code=null;for(const current of [error,error?.actual,error?.cause])for(const raw of [current?.code,current?.meta?.code])if(typeof raw==='string'&&/^(?:P[0-9]{4}|[0-9]{5}|ERR_ASSERTION)$/.test(raw))code=raw;return {kind:'file-fixture113-lifecycle-native',status:'STOP',phase,errorName:/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error?.name??'')?error.name:'Error',code,rollbackVerified:error?.nativeRollbackRestored===true,wholeProducerEndToEndProven:false};}
export async function runLifecycleNative(){lifecycleNativeGuard();const db=new PrismaClient({log:[],errorFormat:'minimal'});try{return await lifecycleRollback(db);}finally{await db.$disconnect();}}
const entry=process.argv[1];if(entry&&path.resolve(entry)===fileURLToPath(import.meta.url)){
 try{assert.deepEqual(process.argv.slice(2),['run','--approved-root']);console.log(JSON.stringify(await runLifecycleNative()));}
 catch(error){console.log(JSON.stringify(safeFailure(error)));process.exitCode=1;}
}
