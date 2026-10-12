// Однократная qualification136: existing5433 → exactpending1 Prisma deploy → preservation proof.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PrismaClient,type Prisma} from "@prisma/client";
import {nativeAcceptanceBinding,nativeDatabaseIdentity,type NativeDeclaration} from "./helpers/native-acceptance-target";
import {nativeSnapshot} from "./helpers/native-acceptance-snapshot";
import {nativeJournal} from "./helpers/native-acceptance-journal";
import {getEventQueueSettings} from "../src/server/plugins/event-queue-contract";

const migration="20261012190000_domain_event_subscriber_delivery",checksum="4d0cc5df129665ecc5aa1824fb885c023cc9373ef6bcfa36c78d67de140b762b";
const containerId="bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const added=["DomainEventDelivery","DomainEventDeliveryPlan"];
const sourcePins={"prisma/schema.prisma":"8f23c0aee35a0e80555203be7f5f4bf4f1e2a8aeb4879871df1b4bb318f86844","src/server/plugins/events.ts":"112e4495f5250dc99ec15b295b82de35e06f13732c22421808b05c61c94335af","src/server/plugins/event-subscriber-store.ts":"027ed88e219d6adcb0ada3d2d17f61b353f8e2817881db12011aef650b492fc7"};
type Database=PrismaClient|Prisma.TransactionClient;
type Ledger={id:string;migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null;applied_steps_count:number};
const ledger=(db:Database)=>db.$queryRawUnsafe<Ledger[]>('SELECT * FROM "_prisma_migrations" ORDER BY id');
async function catalog(db:Database){return{
 columns:await db.$queryRawUnsafe<{table:string;column:string}[]>("SELECT table_name AS \"table\",column_name AS \"column\",data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position"),
 constraints:await db.$queryRawUnsafe<{table:string;name:string}[]>("SELECT t.relname AS \"table\",c.conname AS name,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.conname"),
 indexes:await db.$queryRawUnsafe<{table:string;name:string}[]>("SELECT t.relname AS \"table\",x.relname AS name,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,x.relname")};}
const previousCatalog=(value:Awaited<ReturnType<typeof catalog>>)=>({columns:value.columns.filter(row=>!added.includes(row.table)),constraints:value.constraints.filter(row=>!added.includes(row.table)),indexes:value.indexes.filter(row=>!added.includes(row.table))});

export async function qualifySubscriberMigration(input:NativeDeclaration){
 assert.equal(input.target,"local","LOCAL_MIGRATION_ONLY");assert.equal(input.scenarioId,"subscriber-migration136","EXACT_SCENARIO_REQUIRED");
 for(const key of ["NODE_OPTIONS","NODE_PATH","TSX_TSCONFIG_PATH","TSX_DISABLE_CACHE","ESBUILD_BINARY_PATH"])assert.ok(!process.env[key],"UNEXPECTED_NODE_LOADER");
 assert.equal(process.env.CRM_LOCAL_CONTAINER_ID,containerId,"EXACT_LOCAL_CONTAINER_REQUIRED");assert.equal(getEventQueueSettings().enabled,false,"GLOBAL_WORKER_MUST_REMAIN_DISABLED");
 const binding=nativeAcceptanceBinding(input),web=fileURLToPath(new URL("../",import.meta.url)),repo=path.resolve(web,"../..");
 assert.equal(execFileSync("git",["-C",repo,"rev-parse","HEAD"],{encoding:"utf8",windowsHide:true}).trim(),input.revision,"QUALIFIED_REVISION_REQUIRED");
 const hash=async(file:string)=>createHash("sha256").update(await readFile(path.join(web,file))).digest("hex");
 for(const [file,pin] of Object.entries(sourcePins))assert.equal(await hash(file),pin,"REVIEWED_SOURCE_CHANGED");
 assert.equal(await hash("prisma/migrations/"+migration+"/migration.sql"),checksum,"REVIEWED_MIGRATION_CHANGED");
 const url=new URL(binding.url);url.searchParams.set("connection_limit","1");const db=new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"});
 const publish=await nativeJournal(input);let phase="before",result:Record<string,unknown>|undefined;
 const capture=()=>db.$transaction(async tx=>{await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");await nativeDatabaseIdentity(tx,input);return{original:await nativeSnapshot(tx),catalog:await catalog(tx),ledger:await ledger(tx)};},{isolationLevel:"RepeatableRead",timeout:120000});
 try{
  const before=await capture();assert.equal(Object.keys(before.original.snapshot.rows).length,62,"CURRENT_SCHEMA_SCOPE_REQUIRED");assert.ok(added.every(table=>!before.original.snapshot.rows[table]),"ADDITIVE_TABLE_ALREADY_EXISTS");
  assert.ok(before.ledger.every(row=>row.finished_at!==null||row.rolled_back_at!==null),"FAILED_MIGRATION_HOLD");
  const applied=new Set(before.ledger.filter(row=>row.finished_at!==null&&row.rolled_back_at===null).map(row=>row.migration_name));
  const available=(await readdir(path.join(web,"prisma/migrations"),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  assert.deepEqual(available.filter(name=>!applied.has(name)),[migration],"EXACT_PENDING_MIGRATION_REQUIRED");
  await publish("before",{input,identity:binding.identity,checksum,pending:[migration],...before});await db.$disconnect();phase="prisma-deploy";
  try{execFileSync(process.execPath,[createRequire(import.meta.url).resolve("prisma/build/index.js"),"migrate","deploy","--schema","prisma/schema.prisma"],{cwd:web,windowsHide:true,env:{...process.env,DATABASE_URL:url.toString()},stdio:["ignore","pipe","pipe"],timeout:120000,maxBuffer:1024*1024});}
  catch{throw Error("PRISMA_DEPLOY_HOLD");}
  phase="after";nativeAcceptanceBinding(input);for(const [file,pin] of Object.entries(sourcePins))assert.equal(await hash(file),pin,"REVIEWED_SOURCE_CHANGED");assert.equal(await hash("prisma/migrations/"+migration+"/migration.sql"),checksum,"REVIEWED_MIGRATION_CHANGED");
  const after=await capture();assert.deepEqual(Object.keys(after.original.snapshot.rows).filter(table=>!before.original.snapshot.rows[table]).sort(),added,"EXACT_TWO_ADDED_TABLES_REQUIRED");
  for(const [table,rows] of Object.entries(before.original.snapshot.rows))if(table!=="_prisma_migrations")assert.deepEqual(after.original.snapshot.rows[table],rows,"OLD_ROWS_CHANGED");
  assert.deepEqual(previousCatalog(after.catalog),before.catalog,"OLD_CATALOG_CHANGED");assert.deepEqual(after.original.snapshot.functions,before.original.snapshot.functions,"OLD_FUNCTIONS_CHANGED");assert.deepEqual(after.original.snapshot.triggers,before.original.snapshot.triggers,"OLD_TRIGGERS_CHANGED");
  assert.deepEqual(after.ledger.filter(row=>before.ledger.some(old=>old.id===row.id)),before.ledger,"OLD_LEDGER_CHANGED");
  const fresh=after.ledger.filter(row=>!before.ledger.some(old=>old.id===row.id));assert.equal(fresh.length,1,"EXACT_ONE_LEDGER_REQUIRED");assert.equal(fresh[0].migration_name,migration);assert.equal(fresh[0].checksum,checksum);assert.ok(fresh[0].finished_at);assert.equal(fresh[0].rolled_back_at,null);assert.equal(fresh[0].applied_steps_count,1);
  for(const table of added)assert.deepEqual(after.original.snapshot.rows[table],[{count:"0",hash:"d41d8cd98f00b204e9800998ecf8427e"}],"ADDITIVE_TABLE_MUST_BE_EMPTY");
  assert.deepEqual(after.catalog.columns.filter(row=>row.table==="DomainEventDeliveryPlan").map(row=>row.column),["eventId","createdAt"]);
  assert.deepEqual(after.catalog.columns.filter(row=>row.table==="DomainEventDelivery").map(row=>row.column),["eventId","subscriberId","position","attempts","nextAttemptAt","deliveredAt","skippedAt","lastError","claimToken"]);
  assert.deepEqual(after.catalog.constraints.filter(row=>added.includes(row.table)).map(row=>row.name).sort(),["DomainEventDeliveryPlan_eventId_fkey","DomainEventDeliveryPlan_pkey","DomainEventDelivery_eventId_fkey","DomainEventDelivery_nonnegative_check","DomainEventDelivery_pkey","DomainEventDelivery_terminal_check"].sort());
  assert.deepEqual(after.catalog.indexes.filter(row=>added.includes(row.table)).map(row=>row.name).sort(),["DomainEventDeliveryPlan_pkey","DomainEventDelivery_pkey","DomainEventDelivery_eventId_position_key"].sort());
  await publish("post-ddl-baseline",{input,identity:binding.identity,checksum,...after,oldRowsAndLedgerMatch:true,oldCatalogMatch:true});
  result={status:"QA136_MIGRATION_QUALIFIED",runId:input.runId,revision:input.revision,checksum,oldRowsAndLedgerMatch:true,oldCatalogMatch:true,addedTables:added,newLedger:1,postDdlDigest:after.original.digest,globalWorker:false};
 }catch(error){const message=error instanceof Error?error.message:"",code=/^[A-Z0-9_]+$/.test(message)?message:"QA136_MIGRATION_HOLD_INSPECT";await publish("hold",{input,phase,code,repeatForbidden:true});result={status:"HOLD",runId:input.runId,phase,code,repeatForbidden:true};}
 finally{try{await db.$disconnect();}catch{result={status:"HOLD",runId:input.runId,phase:"disconnect",code:"NATIVE_DISCONNECT_HOLD",repeatForbidden:true};}}
 assert.ok(result);await publish("closed",result);return result;
}
const direct=path.resolve(process.argv[1]??"").toLowerCase()===fileURLToPath(import.meta.url).toLowerCase();
if(direct){const [mode,revision,runId]=process.argv.slice(2);if(mode==="inert")console.log(JSON.stringify({status:"QA136_MIGRATION_INERT",dbConnections:0,ddl:0}));
 else if(mode==="run")void qualifySubscriberMigration({target:"local",revision,runId,scenarioId:"subscriber-migration136"}).then(result=>{console.log(JSON.stringify(result));if(result.status==="HOLD")process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({status:"HOLD",code:"QA136_MIGRATION_GUARD",repeatForbidden:true}));process.exitCode=1;});
 else{console.log(JSON.stringify({status:"HOLD",code:"QA136_MODE_REQUIRED"}));process.exitCode=1;}}
