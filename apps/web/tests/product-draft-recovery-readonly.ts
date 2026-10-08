import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {Client} from "pg";
import {existingLocalCrmDatabaseUrl} from "./helpers/local-crm-database";
import {reportDraftNativeError} from "./helpers/product-draft-native";
let checkId="guard";
async function main(){
 assert.equal(process.argv[2],"discover");
 assert.equal(process.env.CRM_LOCAL_CONTAINER_ID,"bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5");
 const url=existingLocalCrmDatabaseUrl();
 const [container]=JSON.parse(execFileSync("docker",["--context","desktop-linux","inspect","pero_crm_pg"],{encoding:"utf8",windowsHide:true}));
 assert.equal(container.Id,process.env.CRM_LOCAL_CONTAINER_ID);assert.equal(container.Name,"/pero_crm_pg");
 assert.ok(container.Mounts.some((m:{Type:string;Name:string;Destination:string})=>m.Type==="volume"&&m.Name==="pero_crm_v2_pgdata"&&m.Destination==="/var/lib/postgresql/data"));
 const db=new Client({connectionString:url,ssl:false,options:"-c default_transaction_read_only=on -c timezone=UTC -c statement_timeout=30000",application_name:"crm111-owned-recovery-readonly"});
 await db.connect();
 try{
  await db.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
  checkId="identity";
  const {rows:[identity]}=await db.query("SELECT current_database() db,current_schema() schema,current_user role,current_setting('transaction_read_only') ro");
  assert.deepEqual(identity,{db:"pero_crm",schema:"public",role:"pero",ro:"on"});
  checkId="candidate-users";
  const {rows:actors}=await db.query('SELECT id,"createdAt"::text created,"updatedAt"::text updated,roles::text roles,("passwordHash"=$3) disabled FROM "User" WHERE name=$1 AND email LIKE $2 ORDER BY "createdAt" DESC LIMIT 5',["QA111 concurrency","qa111-concurrency-%@invalid.test","QA_DISABLED_NOT_A_PASSWORD"]);
  checkId="actual-foreign-keys";
  const {rows:fks}=await db.query("SELECT c.conname name,t.relname source,r.relname target,c.confdeltype deletion FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='f' AND n.nspname='public' AND (t.relname IN ('ProductPercentageConfig','ProductPercentageParticipant') OR r.relname IN ('Product','Project','User')) ORDER BY t.relname,c.conname");
  const candidates=[];
  for(const actor of actors){
   checkId="candidate-projects";
   const {rows:projects}=await db.query('SELECT id,"clientId" client,"managerId" manager,number,"numberInt" n,stage::text stage,"createdAt"::text created,"updatedAt"::text updated,(title=$2) expected_title FROM "Project" WHERE "managerId"=$1 ORDER BY "numberInt"',[actor.id,"QA111 concurrency"]);
   const ids=projects.map(p=>p.id);
   checkId="candidate-products";
   const {rows:products}=await db.query('SELECT id,"projectId" project,"createdById" creator,number,"suffixInt" suffix,status::text status,"createdAt"::text created,"updatedAt"::text updated,quantity,("expectedPrice" IS NULL) no_price FROM "Product" WHERE "projectId"=ANY($1::text[]) ORDER BY number',[ids]);
   const pids=products.map(p=>p.id);
   checkId="candidate-configs";
   const {rows:configs}=await db.query('SELECT id,"productId" product,kind::text kind,revision,"createdAt"::text created FROM "ProductPercentageConfig" WHERE "productId"=ANY($1::text[]) ORDER BY "productId",kind',[pids]);
   checkId="candidate-protected-links";
   const {rows:[linked]}=await db.query('SELECT (SELECT count(*)::int FROM "ProductPercentageParticipant" WHERE "configId"=ANY($1::text[])) participants,(SELECT count(*)::int FROM "ProductPercentageCompletion" WHERE "productId"=ANY($2::text[])) completions,(SELECT count(*)::int FROM "PayrollEntry" WHERE "projectId"=ANY($3::text[]) OR "userId"=$4) payroll',[configs.map(c=>c.id),pids,ids,actor.id]);
   checkId="candidate-product-history";
   const {rows:history}=await db.query('SELECT id,"productId" product,"fromStatus"::text from_status,"toStatus"::text to_status,"changedById" actor,"createdAt"::text created FROM "ProductStatusHistory" WHERE "productId"=ANY($1::text[]) ORDER BY "createdAt",id',[pids]);
   checkId="candidate-audit";
   const {rows:audit}=await db.query('SELECT id,entity,"entityId" target,action,"createdAt"::text created FROM "ChangeLog" WHERE "actorType"=$1 AND "actorId"=$2 ORDER BY "createdAt",id',["user",actor.id]);
   checkId="candidate-events";
   const {rows:events}=await db.query('SELECT id,type,"processedAt" IS NOT NULL processed,"createdAt"::text created FROM "DomainEvent" WHERE actor=$1 ORDER BY "createdAt",id',[actor.id]);
   candidates.push({actor,projects,products,configs,linked,history,audit,events});
  }
  await db.query("COMMIT");
  const result={kind:"crm111-owned-readonly-discovery",target:"local",readOnly:true,discoveredAt:new Date().toISOString(),candidates,fks};
  const folder=resolve("test-results");mkdirSync(folder,{recursive:true});
  const file=resolve(folder,"task111-recovery-discovery-"+Date.now()+".json");writeFileSync(file,JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({...result,privateArtifact:file}));
 }finally{await db.end();}
}
main().catch(error=>{console.log(JSON.stringify({kind:"crm111-owned-readonly-discovery",status:"FAIL",checkId}));reportDraftNativeError(error);process.exitCode=1;});