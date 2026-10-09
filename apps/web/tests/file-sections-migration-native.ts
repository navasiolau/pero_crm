import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import pg from 'pg';

const migrationUrl = new URL('../prisma/migrations/20261008173000_file_sections/migration.sql', import.meta.url);
const quote = (value:string) => {assert.match(value,/^[A-Za-z_][A-Za-z0-9_]*$/);return '"'+value+'"';};
function guard(){
 const target=process.env.CRM_MODERNIZATION_TARGET,url=new URL(process.env.DATABASE_URL??'');
 assert.equal(url.protocol,'postgresql:');assert.equal(url.hash,'');
 const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 assert.ok([...url.searchParams.keys()].every(key=>options.has(key)&&url.searchParams.getAll(key).length===1),'DATABASE_OPTIONS_STOP');
 assert.ok(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public','SCHEMA_STOP');
 if(target==='local'){
  assert.equal(process.platform,'win32');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');
 }else if(target==='staging'){
  assert.ok(existsSync('/.dockerenv')&&/^[a-f0-9]{12,64}$/.test(hostname()));assert.equal(url.hostname,'db');assert.equal(url.port||'5432','5432');assert.equal(url.pathname,'/crm');assert.equal(process.env.S3_BUCKET,'pero-crm-staging');
  const proof=JSON.parse(process.env.CRM_MODERNIZATION_STAGE_PROOF??'');assert.equal(proof.hostname,'crm-staging');assert.match(proof.revision,/^[a-f0-9]{40}$/);assert.equal(proof.databaseVolume,'crm-staging_pgdata');assert.match(proof.outerW07Sha256,/^[a-f0-9]{64}$/);assert.ok(proof.web&&proof.database);
 }else throw Error('EXPLICIT_TARGET_REQUIRED');
 for(const key of [...url.searchParams.keys()])if(key!=='sslmode')url.searchParams.delete(key);
 return {target,connectionString:url.toString()};
}
async function snapshot(db:pg.Client){
 const tables=(await db.query<{name:string}>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
 const rows:Record<string,{count:string;hash:string}>={};
 for(const table of tables){const result=await db.query<{count:string;hash:string}>(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${quote(table.name)} t`);rows[table.name]=result.rows[0];}
 return rows;
}
async function schema(db:pg.Client){return (await db.query(`SELECT jsonb_build_object('columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.ordinal_position) FROM information_schema.columns c WHERE table_schema='public' AND table_name='File'),'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename='File'),'types',(SELECT jsonb_agg(jsonb_build_object('name',t.typname,'label',e.enumlabel) ORDER BY t.typname,e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN ('FileCategory','FileStage','FileSection'))) AS value`)).rows[0].value;}
async function fileRows(db:pg.Client){return (await db.query<{value:Record<string,unknown>}>(`SELECT to_jsonb(f) AS value FROM "File" f ORDER BY f.id`)).rows.map(row=>row.value);}
async function refs(db:pg.Client){return (await db.query<{value:unknown}>(`SELECT jsonb_build_object('products',(SELECT jsonb_agg(jsonb_build_object('id',id,'sketch',"sketchFileId") ORDER BY id) FROM "Product"),'projects',(SELECT jsonb_agg(jsonb_build_object('id',id,'cover',"coverFileId") ORDER BY id) FROM "Project"),'fks',(SELECT jsonb_agg(pg_get_constraintdef(c.oid) ORDER BY c.conname) FROM pg_constraint c WHERE c.contype='f' AND (c.conrelid='"File"'::regclass OR c.confrelid='"File"'::regclass))) AS value`)).rows[0].value;}
function expectedSection(row:Record<string,unknown>){return row.category==='MEASUREMENT'?'MEASUREMENT':row.productId===null?'GENERAL':row.stage==='INSTALLATION'?'INSTALLATION':'PRODUCTION';}
async function fixtures(db:pg.Client){
 const marker=randomUUID(),clientId=randomUUID(),projectId=randomUUID(),productId=randomUUID(),taskId=randomUUID();
 phase='fixture-client';
 await db.query('INSERT INTO "Client" (id,name,phone,"createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())',[clientId,'QA sections '+marker,'QA_DISABLED_PHONE']);
 phase='fixture-project';
 const numberInt=Number((await db.query('SELECT COALESCE(max("numberInt"),0)+1 AS value FROM "Project"')).rows[0].value);
 await db.query('INSERT INTO "Project" (id,number,"numberInt",title,"clientId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW())',[projectId,String(numberInt),numberInt,'QA sections '+marker,clientId]);
 phase='fixture-product';
 await db.query('INSERT INTO "Product" (id,"projectId",number,"suffixInt",title,"createdAt","updatedAt","deletedAt") VALUES ($1,$2,$3,1,$4,NOW(),NOW(),NOW())',[productId,projectId,String(numberInt)+'.1','QA archived sections '+marker]);
 phase='fixture-task';
 await db.query('INSERT INTO "Task" (id,"projectId",title,"createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())',[taskId,projectId,'QA general task '+marker]);
 phase='fixture-file-matrix';
 let serial=0;const ids:string[]=[];
 for(const category of ['MEASUREMENT','PHOTO','DOCUMENT','OTHER'])for(const stage of ['PRODUCTION','ASSEMBLY','INSTALLATION'])for(const product of [null,productId]){
  const id=randomUUID();ids.push(id);await db.query('INSERT INTO "File" (id,"projectId","productId","taskId",category,stage,caption,"fileName","storedName","mimeType",size,"hasThumb","createdAt") VALUES ($1,$2,$3,$4,$5::"FileCategory",$6::"FileStage",$7,$8,$9,$10,13,true,NOW())',[id,projectId,product,product===null?taskId:null,category,stage,'QA retired caption','QA-'+(++serial)+'.pdf',marker+'-'+serial+'.pdf','application/pdf']);
 }
 const sketchId=ids[7],coverId=ids[6];await db.query('UPDATE "Product" SET "sketchFileId"=$1 WHERE id=$2',[sketchId,productId]);await db.query('UPDATE "Project" SET "coverFileId"=$1 WHERE id=$2',[coverId,projectId]);
 return ids;
}
function safeError(error: unknown){
 const record=error&&typeof error==='object'?error as Record<string,unknown>:{};
 const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)?value:null;
 return {errorName:identifier(record.name)??'UnknownError',code:typeof record.code==='string'&&/^[A-Z0-9]{5}$/.test(record.code)?record.code:null,table:identifier(record.table),column:identifier(record.column),constraint:identifier(record.constraint)};
}
let phase='guard';
async function main(){
 const {target,connectionString}=guard(),db=new pg.Client({connectionString});await db.connect();let inTransaction=false;
 let before:Awaited<ReturnType<typeof snapshot>>|undefined;let beforeSchema:unknown;
 try{
  const identity=(await db.query('SELECT current_database() AS name,current_schema() AS schema')).rows[0];assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
  before=await snapshot(db);beforeSchema=await schema(db);
  phase='schema-guard';const oldColumns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='File'")).rows.map(row=>row.column_name);assert.ok(['category','stage','caption'].every(column=>oldColumns.includes(column))&&!oldColumns.includes('section'),'OLD_FILE_SCHEMA_REQUIRED_STOP');
  await db.query('BEGIN');inTransaction=true;await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='60s'");await db.query('SELECT pg_advisory_xact_lock(18435,55113)');await db.query('LOCK TABLE "File" IN ACCESS EXCLUSIVE MODE');
  phase='rollback-fixtures';const ownedIds=await fixtures(db),originalFiles=await fileRows(db),originalRefs=await refs(db),inside=await snapshot(db);
  phase='actual-migration';const sql=await readFile(migrationUrl,'utf8');assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);const rehearsalSql=sql.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');await db.query(rehearsalSql);
  phase='invariants';const migratedFiles=await fileRows(db);assert.equal(migratedFiles.length,originalFiles.length);const sectionCounts:Record<string,number>={};
  for(let i=0;i<originalFiles.length;i++){const old=originalFiles[i],expected:Record<string,unknown>={...old,section:expectedSection(old)};delete expected.category;delete expected.stage;delete expected.caption;assert.deepEqual(migratedFiles[i],expected);sectionCounts[String(expected.section)]=(sectionCounts[String(expected.section)]??0)+1;}
  assert.deepEqual(await refs(db),originalRefs);const afterInside=await snapshot(db);for(const name of Object.keys(inside))if(name!=='File')assert.deepEqual(afterInside[name],inside[name],name);
  const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='File'")).rows.map(row=>row.column_name);assert.ok(columns.includes('section'));assert.ok(['category','stage','caption'].every(column=>!columns.includes(column)));
  const enumLabels=(await db.query("SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='FileSection' ORDER BY e.enumsortorder")).rows.map(row=>row.enumlabel);assert.deepEqual(enumLabels,['GENERAL','MEASUREMENT','PRODUCTION','INSTALLATION']);assert.equal((await db.query("SELECT count(*)::int AS value FROM pg_type WHERE typname IN ('FileCategory','FileStage')")).rows[0].value,0);
  await db.query('SAVEPOINT section_default');await db.query('INSERT INTO "File" (id,"projectId","fileName","storedName","mimeType",size,"createdAt") SELECT $1,"projectId",$2,$2,$3,1,NOW() FROM "File" LIMIT 1',[randomUUID(),'QA-general-default.pdf','application/pdf']);assert.equal((await db.query('SELECT section FROM "File" WHERE "fileName"=$1',['QA-general-default.pdf'])).rows[0].section,'GENERAL');await db.query('ROLLBACK TO SAVEPOINT section_default');
  phase='rollback';await db.query('ROLLBACK');inTransaction=false;assert.deepEqual(await snapshot(db),before);assert.deepEqual(await schema(db),beforeSchema);
  console.log(JSON.stringify({kind:'file-sections-migration-native',status:'PASS',target,ownedMetadataFixtures:ownedIds.length,existingFileRows:originalFiles.length-ownedIds.length,sectionCounts,allFilesAndStorageKeysPreserved:true,allForeignKeysAndCoverSketchRefsPreserved:true,otherTablesUnchanged:true,oldMetadataRemoved:true,enumAndDefaultVerified:true,rollbackDataAndSchemaVerified:true,storageWrites:0,storageProof:'unchanged metadata keys; original objects were not accessed',capturedTableCount:Object.keys(before).length}));
 }catch(error){
  let rollbackDataAndSchemaVerified=false,rollbackError:ReturnType<typeof safeError>|null=null;
  try {
   if(inTransaction){await db.query('ROLLBACK');inTransaction=false;}
   assert.ok(before,'BASELINE_NOT_CAPTURED_STOP');assert.deepEqual(await snapshot(db),before);assert.deepEqual(await schema(db),beforeSchema);rollbackDataAndSchemaVerified=true;
  }catch(failure){rollbackError=safeError(failure);}
  console.error(JSON.stringify({kind:'file-sections-migration-native',status:'FAIL',phase,...safeError(error),rollbackDataAndSchemaVerified,restorationBaseline:rollbackDataAndSchemaVerified?'MATCH':'UNVERIFIED',rollbackError,storageWrites:0}));process.exitCode=1;
 }finally{if(inTransaction)await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
main().catch(error=>{console.error(JSON.stringify({kind:'file-sections-migration-native',status:'FAIL',phase,...safeError(error),restorationBaseline:'UNVERIFIED'}));process.exitCode=1;});
