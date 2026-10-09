// Root-only LOCAL prerequisite: один fresh-owned Work внутри outer ROLLBACK.
// Только существующий 127.0.0.1:5433/pero_crm; HTTP/S3/миграции здесь не запускаются.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при mismatch.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {newFixturePlan,digest} from './file-fixture113-protocol.mjs';
import {createOwnGraph,ownState,lockOwned,deleteOwnedRows} from './file-fixture113-entry.mjs';
import {workData,workForeignKeyGuard,createTaskWork,restoreTaskWork} from './task-work115-core.mjs';

let phase='guard';
export function taskWorkNativeGuard(env=process.env,platform=process.platform){
 assert.equal(env.CRM_MODERNIZATION_TARGET,'local');assert.equal(platform,'win32');
 const url=new URL(env.DATABASE_URL??'');assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');assert.equal(url.hash,'');
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
const unboundTask=row=>{const{workId,updatedAt,...rest}=row;return rest;};
export async function taskWorkRollback(db){
 phase='baseline-readonly';
 const before=await readonly(db,snapshots),rollback=Error('EXPECTED_NATIVE115_WORK_ROLLBACK'),checks=[];let failure,failurePhase;
 try{await db.$transaction(async tx=>{
  phase='advisory-lock';await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');assert.deepEqual(await snapshots(tx),before);
  phase='actual-work-fk-schema';await workForeignKeyGuard(tx);
  phase='fresh-owned-plan';const p=newFixturePlan(randomUUID(),'a'.repeat(40));p.numberInt=((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1;p.projectNumber=String(p.numberInt);p.productNumber=p.projectNumber+'.1';p.taskTitle='QA113 files '+p.runId;p.articleCode=((await tx.expenseArticle.aggregate({_max:{code:true}}))._max.code??0)+1;
  const actors=Object.values(p.actors).map(row=>row.id),workId=randomUUID();assert.equal(new Set([...Object.values(p.ids),...actors,workId]).size,12);assert.equal(await tx.work.count({where:{id:workId}}),0);assert.equal(await tx.user.count({where:{id:{in:actors}}}),0);assert.equal(await tx.userPreference.count({where:{userId:{in:actors}}}),0);
  phase='actual-shared-creator';await createOwnGraph(tx,p);const initial=await ownState(tx,{plan:p}),beforeTask=initial.rows.Task[0];assert.equal(Object.values(initial.rows).reduce((count,rows)=>count+rows.length,0),11);assert.equal(beforeTask.workId,null);assert.equal(beforeTask.assigneeId,p.actors.engineer.id);assert.equal(typeof beforeTask.updatedAt,'string');assert.equal(initial.rows.UserPreference.length,0);
  phase='actual-own-work-create';const prepared=await createTaskWork(tx,p,beforeTask,workId),expected=workData(p,workId);for(const[key,value]of Object.entries(expected))assert.deepEqual(['quantity','priceSnapshot','total'].includes(key)?Number(prepared.work[key]):prepared.work[key],['quantity','priceSnapshot','total'].includes(key)?Number(value):value);
  assert.equal(prepared.task.workId,workId);assert.equal(typeof prepared.task.updatedAt,'string');assert.deepEqual(unboundTask(prepared.task),unboundTask(beforeTask));assert.equal(typeof prepared.work.createdAt,'string');
  phase='actual-prepared-state';const linked=await ownState(tx,{plan:p});assert.deepEqual(linked.rows.Task,[prepared.task]);assert.deepEqual({...linked.rows,Task:initial.rows.Task},initial.rows);const workRows=await tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM "Work" t WHERE t.id=$1',workId);assert.deepEqual(workRows,[{row:prepared.work}]);
  phase='actual-exact-task-restore-work-delete';const restored=await restoreTaskWork(tx,beforeTask,prepared.task,prepared.work);assert.deepEqual(restored,{task:beforeTask,workDeleted:true});assert.equal(await tx.work.count({where:{id:workId}}),0);
  phase='actual-parent-state-restored';const clean=await ownState(tx,{plan:p});assert.deepEqual(clean.rows,initial.rows);await lockOwned(tx,clean);assert.deepEqual((await ownState(tx,{plan:p})).rows,initial.rows);
  phase='actual-shared-graph-cleanup';const counts=await deleteOwnedRows(tx,clean);assert.equal(Object.values(counts).reduce((sum,count)=>sum+count,0),11);for(const[model,count]of Object.entries({User:3,Client:1,Project:1,Product:1,Task:1,CashAccount:1,ExpenseArticle:1,Payment:2,UserPreference:0}))assert.equal(counts[model],count);
  assert.equal(await tx.user.count({where:{id:{in:actors}}}),0);assert.equal(await tx.userPreference.count({where:{userId:{in:actors}}}),0);assert.equal(await tx.work.count({where:{id:workId}}),0);
  phase='inside-cleanup-original-proof';assert.deepEqual(await snapshots(tx),before);
  checks.push('actual shared 11-row fresh graph creator and selectors','actual Work FK catalogue exact four inbound relations','one fresh owned Work uses paymentKind LEGACY quantity1 zero price/total nullable priceItem','raw Task full-row CAS changes only workId and updatedAt','raw Task including SQL timestamp restored exactly before exact Work delete','ALL original public tables and schema MATCH inside own cleanup');
  phase='expected-outer-rollback';throw rollback;
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});}catch(error){if(error!==rollback){failure=error;failurePhase=phase;}}
 phase='after-outer-rollback-proof';const after=await readonly(db,snapshots);if(digest(before)!==digest(after))throw Error('NATIVE_ORIGINAL_DATA_SCHEMA_RESTORE_MISMATCH');
 if(failure){failure.nativeRollbackRestored=true;phase=failurePhase;throw failure;}
 return {kind:'task-work115-native',status:'PASS',existingPublicTables:before.names.length,creatorRows:11,temporaryWorkRows:1,checks,taskRestoreExact:true,workDeleted:true,rollbackVerified:true,allOriginalDataSchemaRestored:true,originalFinancialFactsPreserved:true,preferencesUntouched:true,actualSharedProducerMethods:true,metadataOnly:true,httpExecuted:false,s3Executed:false,storageWrites:0,migrationsApplied:false,stageExecuted:false,wholeProducerEndToEndProven:false};
}
function safeFailure(error){let code=null;for(const current of [error,error?.actual,error?.cause])for(const raw of [current?.code,current?.meta?.code])if(typeof raw==='string'&&/^(?:P[0-9]{4}|[0-9]{5}|ERR_ASSERTION)$/.test(raw))code=raw;return {kind:'task-work115-native',status:'STOP',phase,errorName:/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error?.name??'')?error.name:'Error',code,stopCode:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'TASK_WORK115_NATIVE_STOP',rollbackVerified:error?.nativeRollbackRestored===true,wholeProducerEndToEndProven:false};}
export async function runTaskWorkNative(){taskWorkNativeGuard();const db=new PrismaClient({log:[],errorFormat:'minimal'});try{return await taskWorkRollback(db);}finally{await db.$disconnect();}}
const entry=process.argv[1];if(entry&&path.resolve(entry)===fileURLToPath(import.meta.url)){
 try{assert.deepEqual(process.argv.slice(2),['run','--approved-root']);console.log(JSON.stringify(await runTaskWorkNative()));}
 catch(error){console.log(JSON.stringify(safeFailure(error)));process.exitCode=1;}
}