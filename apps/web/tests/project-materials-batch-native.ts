// SOURCE_PREPARE148: inert native runner + pure manifest; actual SQL только после reviewed ROOT_GO.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: mismatch/UNKNOWN STOP.
// Actual SQL требует отдельный reviewed protocol + ROOT_GO/exclusive window.
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {readFile,lstat,realpath,open} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Prisma,PrismaClient,Role} from "@prisma/client";

export const NATIVE148_RUN_ID="da24fd79-c99f-409a-a72b-4ce662dd19c1";
export type Native148WarehouseState={phase:string;runId:string}|null;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const prefix="qa148:"+NATIVE148_RUN_ID+":";
const owned=(suffix:string)=>prefix+suffix;
const productId=(index:number)=>owned("product-"+String(index).padStart(2,"0"));

/** Данные фикстур не вызывают Prisma, callbacks, auth или network.
 *  currentState — отдельный заранее проверенный read-only snapshot, не право менять warehouse main.
 */
export function native148FixtureManifest(currentState:Native148WarehouseState,runId=NATIVE148_RUN_ID){
 const prefix="qa148:"+runId+":";
 const owned=(suffix:string)=>prefix+suffix;
 const needId=(index:number,material:"a"|"b")=>owned("need-p"+String(index).padStart(2,"0")+"-"+material);
 const productId=(index:number)=>owned("product-"+String(index).padStart(2,"0"));
 const nonce=(suffix:string)=>{
  const bytes=Buffer.from(hash(prefix+"nonce:"+suffix).slice(0,32),"hex");bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString("hex");return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
 };
 const at=(offset=0)=>new Date(Date.UTC(2026,9,11,0,0,0,offset));
 const auditDates={createdAt:at(),updatedAt:at()};
 const actorRoles:[string,Role[]][]=[
  ["admin",["ADMIN"]],["director",["DIRECTOR"]],["engineer",["ENGINEER"]],
  ["procurement",["PROCUREMENT"]],["manager",["MANAGER"]],["manager-accountant",["MANAGER","ACCOUNTANT"]],
  ["foreign-engineer",["ENGINEER"]],["accountant",["ACCOUNTANT"]],
 ];
 const users:Prisma.UserCreateManyInput[]=actorRoles.map(([suffix,roles])=>({
  id:owned("user-"+suffix),email:"qa148."+suffix+"."+runId+"@invalid.local",
  name:"QA148 "+suffix,position:null,phone:null,telegram:null,passwordHash:"QA148_LOGIN_DISABLED",
  sessionVersion:0,calendarEnabled:false,roles,payScheme:"NONE",payPercent:null,active:true,
  legacyId:null,legacyTable:null,...auditDates,
 }));
 const clients:Prisma.ClientCreateManyInput[]=[{
  id:owned("client"),name:"QA148 "+runId,lastName:null,middleName:null,
  phone:"QA148_NO_CONTACT",email:null,address:null,comment:"Rollback-only148",
  legacyId:null,legacyTable:null,...auditDates,
 }];
 const projects:Prisma.ProjectCreateManyInput[]=["main","deleted"].map((suffix,index)=>({
  id:owned("project-"+suffix),number:String(2147148001+index),numberInt:2147148001+index,
  title:"QA148 "+suffix,stage:"CONTRACT",stageChangedAt:at(),currency:"BYN",initialPrice:null,
  delivery:null,unloading:null,installation:null,address:null,refusalReason:null,refusalComment:null,
  reclamationReason:null,reclamationDescription:null,reclamationFault:null,
  managerId:owned("user-manager"),clientId:owned("client"),createdById:owned("user-admin"),
  legacyId:null,legacyTable:null,coverFileId:null,
  deletedAt:index===1?at(60000):null,deletedById:index===1?owned("user-admin"):null,...auditDates,
 }));
 const products:Prisma.ProductCreateManyInput[]=Array.from({length:25},(_,offset)=>{
  const index=offset+1,deletedProject=index===22,ownEngineer=index===1||index===2||index===23||index===25;
  return {id:productId(index),projectId:owned("project-"+(deletedProject?"deleted":"main")),
   number:String(deletedProject?2147148002:2147148001)+"."+index,suffixInt:index,title:"QA148 product "+index,
   quantity:index===1?4:2,kind:null,status:index===23?"PRODUCTION":index===25?"DRAFT":"DESIGN",
   statusChangedAt:at(),expectedPrice:null,initialPrice:null,initialPriceCaptureEligible:false,description:null,
   assemblerId:null,engineerId:owned(ownEngineer?"user-engineer":"user-foreign-engineer"),
   mounterId:null,noModel:false,surveyorId:null,sketchFileId:null,createdById:owned("user-admin"),
   legacyId:null,legacyTable:null,deletedAt:index===21?at(60000):null,
   deletedById:index===21?owned("user-admin"):null,...auditDates};
 });
 const units:Prisma.MaterialUnitCreateManyInput[]=[{id:owned("unit"),name:"QA148-"+runId,...auditDates}];
 const materials:Prisma.MaterialCreateManyInput[]=["a","b"].map(suffix=>({
  id:owned("material-"+suffix),name:"QA148 material "+suffix,sku:"QA148-"+suffix,unitId:owned("unit"),
  categoryId:null,purchasePrice:suffix==="a"?"9.99":"12.34",minStock:null,active:suffix==="b",
  comment:"Rollback-only148",legacyId:null,legacyTable:null,...auditDates,
 }));
 const needs:Prisma.ProjectMaterialCreateManyInput[]=products.flatMap((_product,offset)=>{
  const index=offset+1;if(index===20)return [];
  return (["a","b"] as const).map(suffix=>({
   id:needId(index,suffix),productId:productId(index),materialId:owned("material-"+suffix),
   quantity:suffix==="b"?(index===1?"1.250":"0.500"):(index===1?"5.000":index===2?"7.000":"2.000"),
   quantityPerUnit:suffix==="b"?(index===1?null:"0.250"):(index===1?"1.250":index===2?"3.500":"1.000"),
   issuedQty:suffix==="b"?(index===1?"1.200":"0.000"):(index===1?"4.000":index===2?"2.000":"0.000"),
   comment:index===1?"Historical issued/tie order148":null,createdById:owned("user-admin"),
   createdAt:at(index*100),updatedAt:at(index*100),
  }));
 });
 const movements:Prisma.StockMovementCreateManyInput[]=[];
 const movement=(suffix:string,index:number|null,type:"EXPENSE"|"RETURN"|"INCOME",quantity:string,
  unitPrice:string|null,totalByn:string|null,offset:number,material:"a"|"b"="a")=>{
  const row:Prisma.StockMovementCreateManyInput={id:owned(suffix),materialId:owned("material-"+material),type,
   receiptKind:type==="INCOME"?(suffix==="latest-income"?"PAID":"INVENTORY"):null,
   deletionId:suffix==="deleted-expense"?owned("deletion"):null,quantity,unitPrice,totalByn,
   productId:index===null?null:productId(index),
   projectMaterialId:index===null||index===20||type==="INCOME"?null:needId(index,material),
   comment:"QA148 "+suffix,createdById:suffix==="expense-001"?owned("missing-author"):owned("user-engineer"),
   createdAt:at(offset)};
  movements.push(row);return row;
 };
 for(let index=1;index<=501;index++)movement("expense-"+String(index).padStart(3,"0"),1,"EXPENSE",
  index===501?"3.000":"1.000",index===1?null:"1.00",index===1?null:index===501?"3.00":"1.00",index);
 movement("return-heavy",1,"RETURN","2.000","1.00","2.00",650);
 movement("latest-income",1,"INCOME","7.000","1.00","7.00",9999);
 movement("deleted-expense",1,"EXPENSE","999.000","1.00","999.00",10000);
 for(let index=2;index<=25;index++)movement("expense-p"+String(index).padStart(2,"0"),index,"EXPENSE","1.000","1.00","1.00",700+index);
 // Одинаковый timestamp: deterministic id DESC должен работать в real ranked SQL.
 movement("return-p02",2,"RETURN","0.500","1.00","0.50",702);
 movement("global-income-a",null,"INCOME","519.500","2.50","1298.75",0);
 movement("global-income-b",null,"INCOME","0.025","12.34","0.31",0,"b");
 const deletions:Prisma.WarehouseMovementDeletionCreateManyInput[]=[{
  id:owned("deletion"),clientMutationId:nonce("deletion"),actorId:owned("user-admin"),
  rootMovementId:owned("deleted-expense"),planFingerprint:hash(prefix+"deletion-plan"),createdAt:at(10001),
 }];
 const current=currentState?.phase==="ACTIVE"||currentState?.phase==="VERIFYING";
 const valuationRun=current?currentState!.runId:owned("legacy-read-run");
 const valuationInputs=[
  {suffix:"heavy",movement:"expense-501",quantity:"3.000",value:"3.000000000",money:"3.00",returned:"2.000",returnedValue:"2.000000000",returnedMoney:"2.00"},
  {suffix:"p02",movement:"expense-p02",quantity:"1.000",value:"1.000000000",money:"1.00",returned:"0.500",returnedValue:"0.500000000",returnedMoney:"0.50"},
  {suffix:"direct",movement:"expense-p20",quantity:"1.000",value:"1.000000000",money:"1.00",returned:"0.000",returnedValue:"0.000000000",returnedMoney:"0.00"},
  {suffix:"deleted-product",movement:"expense-p21",quantity:"1.000",value:"1.000000000",money:"1.00",returned:"0.000",returnedValue:"0.000000000",returnedMoney:"0.00"},
 ];
 const valuations:Prisma.WarehouseMovementValuationCreateManyInput[]=valuationInputs.map((item,index)=>({
  id:owned("valuation-"+item.suffix),movementId:owned(item.movement),sourceMovementId:null,runId:valuationRun,
  clientMutationId:nonce("valuation-"+item.suffix),requestFingerprint:hash(JSON.stringify({runId:runId,item})),
  accountingRevision:index+1,actorId:owned("user-admin"),quantity:item.quantity,unitCost:"1.000000000",
  valueByn:item.value,moneyByn:item.money,returnedQuantity:item.returned,
  returnedValueByn:item.returnedValue,returnedMoneyByn:item.returnedMoney,createdAt:at(11000+index),
 }));
 const balances:Prisma.WarehouseBalanceCreateManyInput[]=[
  {materialId:owned("material-a"),runId:valuationRun,quantity:"2.000",valueByn:"5.000000000",revision:7},
  {materialId:owned("material-b"),runId:valuationRun,quantity:"0.025",valueByn:"0.308500000",revision:1},
 ];
 const rows={User:users,Client:clients,Project:projects,Product:products,MaterialUnit:units,Material:materials,
  ProjectMaterial:needs,StockMovement:movements,WarehouseMovementDeletion:deletions,
  WarehouseMovementValuation:valuations,WarehouseBalance:balances};
 const counts=Object.fromEntries(Object.entries(rows).map(([table,data])=>[table,data.length]));
 const nonceIds=[...deletions,...valuations].map(row=>row.clientMutationId);
 const insertOrder=["User","Client","Project","Product","MaterialUnit","Material","ProjectMaterial","StockMovement","WarehouseMovementDeletion","WarehouseMovementValuation","WarehouseBalance"];
 const insertExceptions=[{table:"StockMovement",id:owned("deleted-expense"),initial:{deletionId:null},final:{deletionId:owned("deletion")}}];
 // PRE включает полный payload + cyclic-FK insertion exception ДО первого INSERT.
 const payload={version:1,kind:"native148-rollback-rows",runId:runId,prefix,
  warehouseContext:{phase:currentState?.phase??"UNINITIALIZED",runId:currentState?.runId??null,readOnly:true},
  currentValuationScope:current,rows,counts,nonceIds,insertOrder,insertExceptions,
  uniqueCollisionFields:{User:["id","email"],Client:["id"],Project:["id","number"],Product:["id","number"],
   MaterialUnit:["id","name"],Material:["id"],ProjectMaterial:["id","productId+materialId"],
   StockMovement:["id"],WarehouseMovementDeletion:["id","clientMutationId","rootMovementId"],
   WarehouseMovementValuation:["id","movementId","clientMutationId"],WarehouseBalance:["materialId"]}};
 return {...payload,rowsHash:hash(JSON.stringify(payload))};
}


type Native148Pin={path:string;sha256:string};
type Native148Approval={version:1;kind:"native148-rollback";runId:string;containerId:string;nodeVersion:string;
 sourceRoot:string;sourceHash:string;sourcePins:Native148Pin[];catalogHash:string;originalHash:string;warehouseHash:string;
 entryHash:string;prePath:string;resultPath:string;stopPath:string;ledgerHash:string;expectedFinished:76;expectedOwned:625};
const native148Filename=fileURLToPath(import.meta.url),native148Root=path.resolve(path.dirname(native148Filename),"../../..");
const localContainer="bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const queueMigrationChecksum="ab60ba2ac3e03aece98856a1fdd4a3ddb65bd2114ecf2fca835e2e3e5e037306";

type Native148LedgerRow={id:string;name:string;checksum:string;finished:boolean;rolledBack:boolean;rowSha256:string};
const percentageMigrationName="20261011130000_product_percentage_missing_configs";
const percentageMigrationChecksum="3c9acc1d0abd632f007e09d3f915188e34993d03b9d660ad646d823c1b6b9e9c";
// Хэш PostgreSQL включает всю строку ledger; проекция и C-порядок совпадают с принятой проверкой167.
export function native148AssertLedger(rows:readonly Native148LedgerRow[],expectedHash:string){
 nativeCheck(rows.length===76&&rows.every(row=>row.finished===true&&row.rolledBack===false),"MIGRATION_76");
 nativeCheck(rows.filter(row=>row.name===percentageMigrationName&&row.checksum===percentageMigrationChecksum).length===1&&
  rows.filter(row=>row.name==="20261011120000_domain_event_queue"&&row.checksum===queueMigrationChecksum).length===1,"MIGRATION_76");
 nativeCheck(/^[a-f0-9]{64}$/.test(expectedHash)&&rows.every(row=>
  typeof row.id==="string"&&typeof row.name==="string"&&/^[a-f0-9]{64}$/.test(row.checksum)&&/^[a-f0-9]{64}$/.test(row.rowSha256)),"LEDGER_SHAPE");
 const projected=rows.map(row=>({id:row.id,name:row.name,checksum:row.checksum,finished:row.finished,rolledBack:row.rolledBack,rowSha256:row.rowSha256}))
  .sort((a,b)=>Buffer.compare(Buffer.from(a.name),Buffer.from(b.name))||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
 const digest=hash(JSON.stringify(projected));nativeCheck(digest===expectedHash,"LEDGER_FROZEN");return digest;
}

const localUrlHelperHash="0b426214023931ca573eccbaafdbe59ca21374f5a64a8519ac06e5b468c8fc47";
const frozenReferenceHash="f16991f9850dbed6f1fcfcf638a3cfd1a58273d6c951249c32dfef2226577cdc";
function nativeCheck(value:unknown,code:string):asserts value{if(!value)throw Error("F148_"+code);}
export function native148ActorIds(rows:readonly Pick<Prisma.UserCreateManyInput,"id">[]){
 return rows.map(row=>{nativeCheck(typeof row.id==="string"&&row.id.startsWith(prefix),"OWN_ACTOR_ID");return row.id;});
}
const bytesHash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
function nativeCode(error:unknown){return error instanceof Error&&/^F148_[A-Z_]+$/.test(error.message)?error.message:"F148_UNKNOWN";}
async function nativeSources(approval:Native148Approval){
 nativeCheck(path.resolve(approval.sourceRoot)===native148Root,"SOURCE_ROOT");
 nativeCheck(approval.sourceHash===hash(JSON.stringify(approval.sourcePins)),"SOURCE_MANIFEST");
 nativeCheck(bytesHash(await readFile(native148Filename))===approval.entryHash,"ENTRY");
 const required=["apps/web/tests/project-materials-batch-native.ts","apps/web/tests/helpers/project-materials-reference.ts",
  "apps/web/tests/helpers/local-crm-database.ts","apps/web/src/server/warehouse/queries.ts",
  "apps/web/src/server/warehouse/accounting.ts","apps/web/src/server/access/visibility.ts",
  "apps/web/prisma/schema.prisma","apps/web/tsconfig.json","apps/web/next.config.ts","apps/web/Dockerfile","pnpm-lock.yaml"];
 for(const requiredPath of required)nativeCheck(approval.sourcePins.some(pin=>pin.path===requiredPath),"SOURCE_CLOSURE_REQUIRED");
 for(const pin of approval.sourcePins){
  nativeCheck(/^[a-f0-9]{64}$/.test(pin.sha256),"SOURCE_PIN");const file=path.resolve(native148Root,pin.path);
  nativeCheck(file.startsWith(native148Root+path.sep)&&await realpath(file)===file&&!(await lstat(file)).isSymbolicLink(),"SOURCE_REDIRECT");
  nativeCheck(bytesHash(await readFile(file))===pin.sha256,"SOURCE_CHANGED");
 }
 const pin=(name:string)=>approval.sourcePins.find(value=>value.path===name)?.sha256;
 nativeCheck(pin("apps/web/tests/helpers/local-crm-database.ts")===localUrlHelperHash,"HELPER_LINEAGE");
 nativeCheck(pin("apps/web/tests/helpers/project-materials-reference.ts")===frozenReferenceHash,"REFERENCE_LINEAGE");
}
async function nativePublish(file:string,value:unknown){
 file=path.resolve(file);const expected=path.join(native148Root,"apps/web/test-results"),parent=path.dirname(file);
 nativeCheck(path.resolve(parent)===expected&&await realpath(parent)===parent&&!(await lstat(parent)).isSymbolicLink(),"EVIDENCE_PARENT");
 nativeCheck(path.basename(file).startsWith("native148-"+NATIVE148_RUN_ID+"-")&&file.endsWith(".json"),"EVIDENCE_NAME");
 const bytes=Buffer.from(JSON.stringify(value,null,2)),handle=await open(file,"wx",0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 nativeCheck(bytesHash(await readFile(file))===bytesHash(bytes),"EVIDENCE_READBACK");
 return {path:file,sha256:bytesHash(bytes)};
}
type NativeDb=Pick<Prisma.TransactionClient,"$queryRaw"|"$queryRawUnsafe"|"warehouseAccountingState">;
type NativeOriginal={table:string;count:number;fingerprint:string;owned:number};
async function originalFingerprint(db:NativeDb){
 const names=await db.$queryRaw<{name:string}[]>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
 const tables:NativeOriginal[]=[];
 for(const {name}of names){
  nativeCheck(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),"CATALOG_IDENTIFIER");
  const quoted='"'+name+'"';
  const [value]=await db.$queryRawUnsafe<NativeOriginal[]>(
   'SELECT count(*) FILTER (WHERE to_jsonb(t)::text NOT LIKE $1)::integer AS count,'+
   'md5(COALESCE(string_agg(to_jsonb(t)::text,E\'\\n\' ORDER BY to_jsonb(t)::text) FILTER (WHERE to_jsonb(t)::text NOT LIKE $1),\'[]\')) AS fingerprint,'+
   'count(*) FILTER (WHERE to_jsonb(t)::text LIKE $1)::integer AS owned FROM public.'+quoted+' t',"%"+prefix+"%");
  tables.push({table:name,count:value.count,fingerprint:value.fingerprint,owned:value.owned});
 }
 return {tables,hash:hash(JSON.stringify(tables.map(({table,count,fingerprint})=>({table,count,fingerprint}))))};
}
type Native148Identity={database:string;user:string;schema:string|null;recovery:boolean;pid:number;others:number};
export function native148AssertIdentity(identity:Native148Identity){
 nativeCheck(identity.schema==="public"&&identity.recovery===false,"TARGET_PUBLIC_PRIMARY");
 nativeCheck(identity.database==="pero_crm"&&identity.user==="pero"&&Number.isInteger(identity.pid)&&identity.pid>0&&identity.others===0,"TARGET_QUIESCENCE");
}
export function native148AssertCatalogHash(expected:unknown,actual:string){
 nativeCheck(typeof expected==="string"&&/^[a-f0-9]{64}$/.test(expected)&&expected===actual,"CATALOG_FROZEN");
}
export function native148WarehouseHash(value:unknown){return hash(JSON.stringify(value));}
export {originalFingerprint as native148OriginalFingerprint};
export async function native148ReadCatalog(db:NativeDb,expectedLedgerHash:string){
 const [identity]=await db.$queryRaw<Native148Identity[]>`
  SELECT current_database() AS database,current_user AS "user",current_schema() AS schema,pg_is_in_recovery() AS recovery,pg_backend_pid() AS pid,
   (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS others`;
 native148AssertIdentity(identity);
 const migrations=await db.$queryRaw<{finished:number;unresolved:number;last:string;checksum:string;percentageChecksum:string}[]>`
  SELECT count(*) FILTER(WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS finished,
   count(*) FILTER(WHERE finished_at IS NULL AND rolled_back_at IS NULL)::integer AS unresolved,
   (SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1) AS last,
   (SELECT checksum FROM "_prisma_migrations" WHERE migration_name='20261011120000_domain_event_queue' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS checksum,
   (SELECT checksum FROM "_prisma_migrations" WHERE migration_name='20261011130000_product_percentage_missing_configs' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "percentageChecksum"
  FROM "_prisma_migrations"`;
 nativeCheck(migrations[0].finished===76&&migrations[0].unresolved===0&&migrations[0].last===percentageMigrationName&&migrations[0].checksum===queueMigrationChecksum&&migrations[0].percentageChecksum===percentageMigrationChecksum,"MIGRATION_76");
 const ledgerRows=await db.$queryRaw<Native148LedgerRow[]>`SELECT id,migration_name AS name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS "rolledBack",
  encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') AS "rowSha256" FROM "_prisma_migrations" m ORDER BY migration_name COLLATE "C",id COLLATE "C"`;
 const ledgerHash=native148AssertLedger(ledgerRows,expectedLedgerHash);
 const columns=await db.$queryRaw<{name:string;type:string;nullable:boolean;defaultValue:string|null}[]>`
  SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS "defaultValue"
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='"DomainEvent"'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`;
 nativeCheck(columns.length===13,"DOMAIN_COLUMNS");
 for(const name of ["claimToken","leaseUntil","exhaustedAt"])nativeCheck(columns.some(column=>column.name===name&&column.nullable),"QUEUE_NULLABLE");
 nativeCheck(columns.some(column=>column.name==="queueAttempts"&&column.type==="integer"&&!column.nullable&&column.defaultValue==="0"),"QUEUE_BUDGET");
 nativeCheck(columns.some(column=>column.name==="nextAttemptAt"&&column.type==="timestamp(6) with time zone"&&!column.nullable),"QUEUE_DUE");
 for(const name of ["leaseUntil","exhaustedAt"])nativeCheck(columns.some(column=>column.name===name&&column.type==="timestamp(6) with time zone"),"QUEUE_TIME_TYPE");
 const indexes=await db.$queryRaw<{name:string;definition:string;valid:boolean;ready:boolean}[]>`
  SELECT ci.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready
  FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid='"DomainEvent"'::regclass ORDER BY ci.relname`;
 const constraints=await db.$queryRaw<{name:string;definition:string;validated:boolean}[]>`
  SELECT conname AS name,pg_get_constraintdef(oid) AS definition,convalidated AS validated
  FROM pg_constraint WHERE conrelid='"DomainEvent"'::regclass ORDER BY conname`;
 nativeCheck(indexes.some(index=>index.name==="DomainEvent_ready_queue_idx"&&index.valid&&index.ready),"QUEUE_INDEX");
 nativeCheck(constraints.some(constraint=>constraint.name==="DomainEvent_queueAttempts_nonnegative"&&constraint.validated),"QUEUE_CHECK");
 const catalog={migrations,ledgerHash,columns,indexes,constraints};
 return {pid:identity.pid,catalogHash:hash(JSON.stringify(catalog)),ledgerHash,finished:migrations[0].finished,unresolved:migrations[0].unresolved,domainColumns:columns.length};
}
async function nativeCatalog(db:NativeDb,approval:Native148Approval){
 const observed=await native148ReadCatalog(db,approval.ledgerHash);
 native148AssertCatalogHash(approval.catalogHash,observed.catalogHash);return observed;
}
async function nativeCollisions(tx:Prisma.TransactionClient,manifest:ReturnType<typeof native148FixtureManifest>){
 nativeCheck((await tx.project.count({where:{number:{in:manifest.rows.Project.map(row=>row.number)}}}))===0,"PROJECT_NUMBER_COLLISION");
 nativeCheck((await tx.product.count({where:{number:{in:manifest.rows.Product.map(row=>row.number)}}}))===0,"PRODUCT_NUMBER_COLLISION");
 nativeCheck((await tx.user.count({where:{email:{in:manifest.rows.User.map(row=>row.email)}}}))===0,"EMAIL_COLLISION");
 nativeCheck((await tx.materialUnit.count({where:{name:{in:manifest.rows.MaterialUnit.map(row=>row.name)}}}))===0,"UNIT_COLLISION");
 nativeCheck((await tx.warehouseMovementDeletion.count({where:{clientMutationId:{in:manifest.nonceIds}}}))===0,"DELETION_NONCE_COLLISION");
 nativeCheck((await tx.warehouseMovementValuation.count({where:{clientMutationId:{in:manifest.nonceIds}}}))===0,"VALUATION_NONCE_COLLISION");
}
async function nativeInsert(tx:Prisma.TransactionClient,manifest:ReturnType<typeof native148FixtureManifest>){
 const rows=manifest.rows;
 await tx.user.createMany({data:rows.User});await tx.client.createMany({data:rows.Client});
 await tx.project.createMany({data:rows.Project});await tx.product.createMany({data:rows.Product});
 await tx.materialUnit.createMany({data:rows.MaterialUnit});await tx.material.createMany({data:rows.Material});
 await tx.projectMaterial.createMany({data:rows.ProjectMaterial});
 await tx.stockMovement.createMany({data:rows.StockMovement.map(row=>({...row,deletionId:null}))});
 await tx.warehouseMovementDeletion.createMany({data:rows.WarehouseMovementDeletion});
 await tx.stockMovement.update({where:{id:manifest.insertExceptions[0].id},data:{deletionId:manifest.insertExceptions[0].final.deletionId}});
 await tx.warehouseMovementValuation.createMany({data:rows.WarehouseMovementValuation});
 await tx.warehouseBalance.createMany({data:rows.WarehouseBalance});
}

const native148EngineHash="263946105f428384d2318dc3241b85b1c3dd98fbb1bfac62d3e81f513ab35897";
export function native148AssertEngineEnvironment(env:Record<string,string|undefined>){
 for(const key of ["PRISMA_QUERY_ENGINE_LIBRARY","PRISMA_QUERY_ENGINE_BINARY","PRISMA_CLIENT_ENGINE_TYPE"])
  nativeCheck(!env[key],"ENGINE_OVERRIDE");
}
export function native148AssertLoadedEngine(values:unknown,expected:string){
 nativeCheck(Array.isArray(values)&&values.every(value=>typeof value==="string"),"LOADED_ENGINE");
 const engines=[...new Set((values as string[]).filter(value=>/query_engine.*\.(?:node|dll|so|dylib)$/i.test(path.basename(value))).map(value=>path.resolve(value)))];
 nativeCheck(engines.length===1&&engines[0]===path.resolve(expected),"LOADED_ENGINE");
 return engines[0];
}

export function native148GeneratedEnginePins(pins:readonly Native148Pin[]){
 return pins.filter(pin=>{
  const parts=pin.path.split(/[\\/]/);
  return parts.length===7&&parts[0]==="node_modules"&&parts[1]===".pnpm"&&/^@prisma\+client@6\.19\.3(?:_|$)/.test(parts[2])&&
   parts[3]==="node_modules"&&parts[4]===".prisma"&&parts[5]==="client"&&parts[6]==="query_engine-windows.dll.node";
 });
}

export async function native148LoadedEngine(approval:Pick<Native148Approval,"sourcePins">){
 const pins=native148GeneratedEnginePins(approval.sourcePins);
 nativeCheck(pins.length===1&&pins[0].sha256===native148EngineHash,"ENGINE_PIN");
 const expected=path.resolve(native148Root,pins[0].path);
 // Полный диагностический report не сохраняется и не передаётся: извлекаем только пути DLL.
 const shared:unknown=(()=>{
  nativeCheck(process.report&&typeof process.report.getReport==="function","ENGINE_REPORT");
  const value:unknown=process.report.getReport();
  nativeCheck(value&&typeof value==="object"&&"sharedObjects" in value,"ENGINE_REPORT");
  return value.sharedObjects;
 })();
 nativeCheck(Array.isArray(shared)&&shared.every(value=>typeof value==="string"),"LOADED_ENGINE");
 const enginePaths=shared.filter(value=>/query_engine.*\.(?:node|dll|so|dylib)$/i.test(path.basename(value)));
 const canonical=await Promise.all(enginePaths.map(value=>realpath(value)));
 native148AssertLoadedEngine(canonical,expected);
 nativeCheck(await realpath(expected)===expected&&!(await lstat(expected)).isSymbolicLink()&&bytesHash(await readFile(expected))===native148EngineHash,"ENGINE_LOADED_PIN");
 return {path:pins[0].path,sha256:native148EngineHash,loaded:true};
}

class Native148Rollback extends Error{}
async function executeNative148(approval:Native148Approval){
 nativeCheck(approval.version===1&&approval.kind==="native148-rollback"&&approval.runId===NATIVE148_RUN_ID&&
  approval.containerId===localContainer&&approval.nodeVersion===process.version&&approval.expectedFinished===76&&approval.expectedOwned===625&&/^[a-f0-9]{64}$/.test(approval.ledgerHash),"APPROVAL");
 await nativeSources(approval);native148AssertEngineEnvironment(process.env);
 const priorUrl=process.env.DATABASE_URL,priorContainer=process.env.CRM_LOCAL_CONTAINER_ID;
 let db:PrismaClient|undefined,sourceDb:Pick<PrismaClient,"$disconnect">|undefined,baseline:Awaited<ReturnType<typeof originalFingerprint>>|undefined;
 let loadedEngine:Awaited<ReturnType<typeof native148LoadedEngine>>|undefined;
 let rollbackKnown=false,pre:Awaited<ReturnType<typeof nativePublish>>|undefined,report:unknown,hasFailure=false,primary:unknown;
 const finalFailures:string[]=[];
 try{
  process.env.CRM_LOCAL_CONTAINER_ID=approval.containerId;
  const {existingLocalCrmDatabaseUrl}=await import("./helpers/local-crm-database");
  const target=new URL(existingLocalCrmDatabaseUrl());
  nativeCheck(target.hostname==="127.0.0.1"&&target.port==="5433"&&target.pathname==="/pero_crm"&&target.username==="pero","URL_TARGET");
  target.searchParams.set("connection_limit","1");process.env.DATABASE_URL=target.toString();
  const {PrismaClient:Client,Prisma:runtime}=await import("@prisma/client");
  nativeCheck(runtime.prismaVersion.client==="6.19.3","PRISMA_VERSION");
  const observations:Prisma.QueryEvent[]=[];
  const client=new Client({datasources:{db:{url:target.toString()}},log:[{emit:"event",level:"query"}]});
  db=client;client.$on("query",event=>observations.push(event));
  const initial=await nativeCatalog(client,approval);loadedEngine=await native148LoadedEngine(approval);
  baseline=await originalFingerprint(client);nativeCheck(baseline.hash===approval.originalHash&&baseline.tables.every(table=>table.owned===0),"ORIGINAL_BEFORE");
  sourceDb=(await import("../src/lib/prisma")).prisma;
  const source=await import("../src/server/warehouse/queries");
  const reference=await import("./helpers/project-materials-reference");
  const rollback=new Native148Rollback("F148_EXPECTED_ROLLBACK"),results:{scenario:string;dtoHash:string;queryCount?:number}[]=[];
  let ordinal=0;
  const markerEvent=(id:string)=>observations.findIndex(event=>{
   if(!event.query.includes('"native148Marker"'))return false;
   try{return (JSON.parse(event.params) as unknown[]).includes(id);}catch{return false;}
  });
  const fence=async(tx:Prisma.TransactionClient)=>{
   const id=prefix+"query-marker-"+ordinal++;
   await tx.$queryRaw`SELECT ${id}::text AS "native148Marker"`;
   const deadline=performance.now()+10000;
   while(markerEvent(id)<0){nativeCheck(performance.now()<deadline,"QUERY_EVENT_DEADLINE");await new Promise(resolve=>setTimeout(resolve,5));}
   return markerEvent(id);
  };
  try{
   await client.$transaction(async tx=>{
    const current=await nativeCatalog(tx,approval);nativeCheck(current.pid===initial.pid,"BACKEND_PID");
    const state=await tx.warehouseAccountingState.findUnique({where:{id:"main"}});
    nativeCheck(native148WarehouseHash(state)===approval.warehouseHash,"WAREHOUSE_CURRENT");
    const manifest=native148FixtureManifest(state),before=await originalFingerprint(tx);
    nativeCheck(before.hash===baseline!.hash&&before.tables.every(table=>table.owned===0),"ORIGINAL_TX_BEFORE");
    await nativeCollisions(tx,manifest);
    pre=await nativePublish(approval.prePath,{version:1,kind:"native148-durable-pre",approval,manifest,baseline:before,warehouse:{id:state?.id??null,phase:state?.phase??"UNINITIALIZED",runId:state?.runId??null,sha256:approval.warehouseHash},backendPid:current.pid,mode:"ONE_RR_ROLLBACK_ONLY"});
    let bodyFailed=false,bodyError:unknown,guardFailed=false,guardError:unknown;
    try{
     await nativeInsert(tx,manifest);
     const inserted=await originalFingerprint(tx);
     nativeCheck(inserted.hash===before.hash&&inserted.tables.reduce((sum,table)=>sum+table.owned,0)===625,"EXACT_INSERT_GRAPH");
     for(const table of inserted.tables)nativeCheck(table.owned===(manifest.counts[table.table as keyof typeof manifest.counts]??0),"TABLE_OWNED_COUNT");
     const users=await tx.user.findMany({where:{id:{in:native148ActorIds(manifest.rows.User)}},select:{id:true,roles:true}});
     const actor=(suffix:string)=>{const user=users.find(user=>user.id===owned("user-"+suffix));nativeCheck(user,"OWN_ACTOR");return {id:user.id,roles:user.roles};};
     const ids=Array.from({length:25},(_,index)=>productId(index+1)),counts:number[]=[];
     for(const size of [1,5,20]){
      const selected=ids.slice(0,size),who=actor("admin");
      const expected=await Promise.all(selected.map(id=>reference.frozenGetProjectMaterials(id,who,tx)));
      const begin=await fence(tx),actual=await source.getProjectMaterialsBatch(selected,who,tx),end=await fence(tx);
      assert.deepEqual(actual,expected);
      const count=end-begin-1;nativeCheck(count>0,"QUERY_EVENTS");counts.push(count);
      assert.deepEqual(await source.getProjectMaterials(selected[0],who,tx),expected[0]);
      results.push({scenario:"batch-"+size,dtoHash:hash(JSON.stringify(actual)),queryCount:count});
      nativeCheck((await originalFingerprint(tx)).hash===before.hash,"ORIGINAL_AFTER_SCENARIO");
     }
     nativeCheck(counts[2]<=counts[0]+2,"QUERY_COUNT_BUDGET");
     for(const role of ["admin","director","engineer","procurement","manager","manager-accountant"]){
      const who=actor(role),selected=[ids[22],ids[0],ids[22],ids[19],ids[20],ids[21],ids[23],ids[24],owned("missing-product")];
      const expected=await Promise.all(selected.map(id=>reference.frozenGetProjectMaterials(id,who,tx)));
      const actual=await source.getProjectMaterialsBatch(selected,who,tx);assert.deepEqual(actual,expected);
      results.push({scenario:"roles-"+role,dtoHash:hash(JSON.stringify(actual))});
      nativeCheck((await originalFingerprint(tx)).hash===before.hash,"ORIGINAL_AFTER_ACL");
     }
     const accountant=actor("accountant"),emptyBegin=await fence(tx);
     assert.deepEqual(await source.getProjectMaterialsBatch([],accountant,tx),[]);
     const emptyEnd=await fence(tx);nativeCheck(emptyEnd-emptyBegin===1,"EMPTY_SQL");
     await assert.rejects(source.getProjectMaterialsBatch([ids[0]],accountant,tx),/Недостаточно прав/);
     const facts=await source.getProjectMaterialsBatch([ids[0],ids[1],ids[19]],actor("admin"),tx);
     nativeCheck(facts[0].movements.length===499&&facts[0].materialsTotalByn===null,"FULL_HISTORY_NULL");
     nativeCheck(!facts[0].movements.some(row=>row.id===owned("expense-001")||row.id===owned("latest-income")||row.id===owned("deleted-expense")),"DISPLAY_CAP_FILTER");
     nativeCheck(facts[0].lines.length===2&&facts[0].lines.some(line=>line.quantityPerUnit===1.25),"NEEDS_FALLBACK");
     nativeCheck(facts[2].lines.length===0,"DIRECT_NO_NEEDS");
     nativeCheck(facts[0].warehouseReady===(state?.phase==="ACTIVE"),"ACTUAL_PHASE_ONLY");
     report={level:"postgresql-rollback-native",actualPhase:state?.phase??"UNINITIALIZED",activeWacProved:state?.phase==="ACTIVE"||state?.phase==="VERIFYING",
      counts,results,rowsHash:manifest.rowsHash,ownedRows:625,backendPid:current.pid,queryFence:"PUBLIC_EVENTS_CAPTURED_BETWEEN_TWO_MARKERS"};
    }catch(error){bodyFailed=true;bodyError=error;}
    finally{
     try{
      nativeCheck((await originalFingerprint(tx)).hash===before.hash,"ORIGINAL_FINALLY");
      nativeCheck(native148WarehouseHash(await tx.warehouseAccountingState.findUnique({where:{id:"main"}}))===approval.warehouseHash,"WAREHOUSE_FINALLY");
     }catch(error){guardFailed=true;guardError=error;finalFailures.push(nativeCode(error));}
    }
    if(bodyFailed)throw bodyError;
    if(guardFailed)throw guardError;
    throw rollback;
   },{isolationLevel:"RepeatableRead",maxWait:10000,timeout:120000});
  }catch(error){if(error===rollback)rollbackKnown=true;else throw error;}
  nativeCheck(rollbackKnown,"ROLLBACK_EXPECTED");
 }catch(error){hasFailure=true;primary=error;}
 finally{
  if(db){
   try{
    const observed=await originalFingerprint(db);
    nativeCheck(observed.tables.every(table=>table.owned===0),"POST_OWN_ZERO");
    nativeCheck(baseline&&observed.hash===baseline.hash,"POST_ORIGINALS");
    nativeCheck(native148WarehouseHash(await db.warehouseAccountingState.findUnique({where:{id:"main"}}))===approval.warehouseHash,"POST_WAREHOUSE");
    await nativeCatalog(db,approval);await nativeSources(approval);
   }catch(error){finalFailures.push(nativeCode(error));}
  }
  for(const client of [sourceDb,db])if(client)try{await client.$disconnect();}catch{finalFailures.push("F148_DISCONNECT_UNKNOWN");}
  if(priorUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=priorUrl;
  if(priorContainer===undefined)delete process.env.CRM_LOCAL_CONTAINER_ID;else process.env.CRM_LOCAL_CONTAINER_ID=priorContainer;
 }
 if(hasFailure||finalFailures.length||!rollbackKnown){
  const receipt=await nativePublish(approval.stopPath,{status:"STOP",pre,primary:hasFailure?nativeCode(primary):null,finalFailures,
   rollbackKnown,hold:true,staging:"NOT_RUN",outbound:"NO_CALL_PATH"});
  console.error(JSON.stringify({status:"STOP",receipt,code:hasFailure?nativeCode(primary):"F148_FINAL_UNKNOWN"}));throw Error("F148_STOP");
 }
 const receipt=await nativePublish(approval.resultPath,{status:"PASS",pre,report,rollbackKnown,protectedHash:baseline!.hash,remainingOwned:0,clientsDisconnected:true,
  sourceHash:approval.sourceHash,loadedEngine,staging:"NOT_RUN",outbound:"NO_CALL_PATH"});
 console.log(JSON.stringify({status:"PASS",receipt,level:"postgresql-rollback-native",staging:"NOT_RUN"}));
}
export async function native148Main(args:string[]){
 nativeCheck(args.includes("--authorized-local-native"),"EXPLICIT_AUTHORIZATION");
 const file=args[args.indexOf("--approval-file")+1],expectedSha=args[args.indexOf("--expected-file-sha")+1];
 nativeCheck(file&&path.isAbsolute(file),"APPROVAL_PATH");nativeCheck(/^[a-f0-9]{64}$/.test(expectedSha??""),"APPROVAL_SEAL");
 nativeCheck(!(await lstat(file)).isSymbolicLink(),"APPROVAL_LINK");
 const bytes=await readFile(file);nativeCheck(bytesHash(bytes)===expectedSha,"APPROVAL_CHANGED");
 await executeNative148(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,"")) as Native148Approval);
}
if(path.resolve(process.argv[1]??"")===native148Filename)void native148Main(process.argv.slice(2)).catch(error=>{
 console.error(JSON.stringify({status:"STOP",code:nativeCode(error),hold:true}));process.exitCode=1;
});

// Текущий тонкий native-прогон: старые compiler/closure approvals выше не используются.
export async function native148ThinSourceDigest(){
 const paths=["apps/web/src/server/warehouse/queries.ts","apps/web/src/app/(app)/projects/[id]/page.tsx","apps/web/tests/helpers/project-materials-reference.ts","apps/web/tests/project-materials-batch-native.ts","apps/web/src/server/warehouse/accounting.ts","apps/web/src/server/warehouse/report-documents.ts","apps/web/src/server/access/visibility.ts","apps/web/prisma/schema.prisma","apps/web/tests/helpers/native-acceptance-target.ts","apps/web/tests/helpers/native-acceptance-snapshot.ts"];
 const pins=await Promise.all(paths.map(async file=>[file,bytesHash(await readFile(path.join(native148Root,file)))]));
 return hash(JSON.stringify(pins));
}

function native148FirstDifference(actual:unknown,expected:unknown,path:(string|number)[]=[],depth=0):{path:(string|number)[];kind:string;actualCount?:number;expectedCount?:number}|null{
 if(Object.is(actual,expected))return null;
 if(depth>8)return{path,kind:"depth-limit"};
 if(Array.isArray(actual)&&Array.isArray(expected)){
  if(actual.length!==expected.length)return{path,kind:"array-length",actualCount:actual.length,expectedCount:expected.length};
  for(let index=0;index<expected.length;index++){const found=native148FirstDifference(actual[index],expected[index],[...path,index],depth+1);if(found)return found;}
  return null;
 }
 if(actual&&expected&&typeof actual==="object"&&typeof expected==="object"){
  const left=actual as Record<string,unknown>,right=expected as Record<string,unknown>;
  const fields=new Set(["lines","movements","materialsTotalByn","returnSources","warehouseReady","hasShortage","id","materialId","name","sku","unit","quantity","quantityPerUnit","issuedQty","needed","inStock","shortage","status","purchasePrice","comment","returnableQuantity","legacyReturnQuantity","unitPrice","type","receiptKind","materialName","materialUnit","totalByn","productId","productNumber","createdByName","createdAt","reportDocument","fileId","filename","mimeType","url","size","money","hasDebt","debt"]);
  const expectedKeys=Object.keys(right);
  if(Object.keys(left).length!==expectedKeys.length)return{path,kind:"object-field-count",actualCount:Object.keys(left).length,expectedCount:expectedKeys.length};
  for(const key of expectedKeys){const field=fields.has(key)?key:"other-field";if(!Object.hasOwn(left,key))return{path:[...path,field],kind:"missing-field"};const found=native148FirstDifference(left[key],right[key],[...path,field],depth+1);if(found)return found;}
  return null;
 }
 return{path,kind:typeof actual===typeof expected?"value":"type"};
}
type Thin148Input=import("./helpers/native-acceptance-target").NativeDeclaration&{expectedOriginalDigest:string};
export async function runMaterialsBatchNative(input:Thin148Input){
 nativeCheck(process.env.CRM_NATIVE148_GO==="OWNED_ROLLBACK","EXPLICIT_THIN_NATIVE_GO");
 nativeCheck(/^[a-f0-9]{64}$/.test(input.expectedOriginalDigest),"ORIGINAL_DIGEST_REQUIRED");
 const sourceDigest=await native148ThinSourceDigest();nativeCheck(sourceDigest===process.env.CRM_NATIVE148_SOURCE_SHA256,"THIN_SOURCE_PIN");
 native148AssertEngineEnvironment(process.env);
 const [{nativeAcceptanceBinding,nativeDatabaseIdentity},{nativeSnapshot,verifiedRollback}]=await Promise.all([import("./helpers/native-acceptance-target"),import("./helpers/native-acceptance-snapshot")]);
 const binding=nativeAcceptanceBinding(input),{PrismaClient:Client}=await import("@prisma/client");
 const db=new Client({datasourceUrl:binding.url,log:[{emit:"event",level:"query"}]});
 const events:Prisma.QueryEvent[]=[];db.$on("query",event=>events.push(event));
 const originalFetch=globalThis.fetch,originalPrisma=(globalThis as{prisma?:PrismaClient}).prisma;
 let phase="ORIGINAL_BEFORE",failurePhase:string|undefined,originalsMatch:boolean|null=null,sourceMatch:boolean|null=null,ownRowsAfter:number|null=null,outbound=0;
 let beforeDigest:string|null=null,afterDigest:string|null=null,rejected=false;const partialQueryCounts:number[]=[];
 const prefix="qa148:"+input.runId+":";
 globalThis.fetch=async()=>{outbound++;throw Error("F148_OUTBOUND");};
 const tables=["User","Client","Project","Product","MaterialUnit","Material","ProjectMaterial","StockMovement","WarehouseMovementDeletion","WarehouseMovementValuation","WarehouseBalance"] as const;
 const fingerprint=(countOwn=false)=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");await nativeDatabaseIdentity(tx,input);
  const result=await nativeSnapshot(tx);
  if(countOwn){ownRowsAfter=0;for(const table of tables){const column=table==="WarehouseBalance"?"materialId":"id";const [row]=await tx.$queryRawUnsafe<{count:number}[]>(`SELECT count(*)::integer AS count FROM "${table}" WHERE "${column}" LIKE $1`,prefix+"%");ownRowsAfter+=row.count;}}
  return result;
 },{isolationLevel:"RepeatableRead",timeout:120000});
 try{
  const before=await fingerprint();beforeDigest=before.digest;nativeCheck(before.digest===input.expectedOriginalDigest,"ORIGINAL_BASELINE");
  return await verifiedRollback(async()=>{
   const rollback=new Error("F148_THIN_EXPECTED_ROLLBACK");let report:Record<string,unknown>|undefined;
   try{await db.$transaction(async tx=>{
    await nativeDatabaseIdentity(tx,input);await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
    const [target]=await tx.$queryRaw<{primary:boolean}[]>`SELECT NOT pg_is_in_recovery() AS primary`;nativeCheck(target.primary,"TARGET_PRIMARY");
    (globalThis as{prisma?:PrismaClient}).prisma=tx as unknown as PrismaClient;
    const source=await import("../src/server/warehouse/queries"),reference=await import("./helpers/project-materials-reference");
    const state=await tx.warehouseAccountingState.findUnique({where:{id:"main"}});
    const manifest=native148FixtureManifest(state,input.runId);
    const ownedKeys:import("./helpers/native-acceptance-snapshot").OwnedRowKeys={};
    for(const table of tables){const column=table==="WarehouseBalance"?"materialId":"id";const rows=manifest.rows[table];const keys=rows.map(row=>Reflect.get(row,column));nativeCheck(keys.every(key=>typeof key==="string"&&key.startsWith(prefix)),"THIN_OWN_KEYS");ownedKeys[table]={column,ids:keys as string[]};}
    phase="FIXTURE_COLLISIONS";await nativeCollisions(tx,manifest);
    phase="FIXTURE_INSERT";await nativeInsert(tx,manifest);
    nativeCheck((await nativeSnapshot(tx,ownedKeys)).digest===before.digest,"ORIGINAL_DURING");
    const users=await tx.user.findMany({where:{id:{in:manifest.rows.User.map(row=>row.id!)}},select:{id:true,roles:true}});
    const actor=(suffix:string)=>{const user=users.find(user=>user.id===prefix+"user-"+suffix);nativeCheck(user,"THIN_OWN_ACTOR");return user;};
    const ids=manifest.rows.Product.map(row=>row.id!),counts:number[]=[],results:{scenario:string;dtoHash:string}[]=[];
    let sequence=0;
    const fence=async()=>{const marker=prefix+"fence-"+sequence++;await tx.$queryRaw`SELECT ${marker}::text AS "native148Fence"`;const deadline=performance.now()+5000;let at=-1;while((at=events.findIndex(event=>event.query.includes('"native148Fence"')&&event.params.includes(marker)))<0){nativeCheck(performance.now()<deadline,"THIN_EVENT_FENCE");await new Promise(resolve=>setTimeout(resolve,1));}return at;};
    for(const size of [1,5,20]){
     phase="QUERY_COUNT_"+size;const selected=ids.slice(0,size),who=actor("admin");
     const expected=await Promise.all(selected.map(id=>reference.frozenGetProjectMaterials(id,who,tx)));
     const begin=await fence(),actual=await source.getProjectMaterialsBatch(selected,who,tx),end=await fence();
     partialQueryCounts.push(end-begin-1);assert.deepEqual(actual,expected,"F148_THIN_DTO");counts.push(end-begin-1);
     assert.deepEqual(await source.getProjectMaterials(selected[0],who,tx),expected[0],"F148_THIN_SCALAR");
     results.push({scenario:"batch-"+size,dtoHash:hash(JSON.stringify(actual))});
    }
    nativeCheck(counts[0]>0&&counts[2]<=counts[0]+2,"THIN_QUERY_BUDGET");
    for(const role of ["admin","director","engineer","procurement","manager","manager-accountant"]){
     phase="ROLE_"+role;const who=actor(role),selected=[ids[22],ids[0],ids[22],ids[19],ids[20],ids[21],ids[23],ids[24],prefix+"missing-product"];
     const expected=await Promise.all(selected.map(id=>reference.frozenGetProjectMaterials(id,who,tx))),actual=await source.getProjectMaterialsBatch(selected,who,tx);
     assert.deepEqual(actual,expected,"F148_THIN_ROLE_DTO");results.push({scenario:role,dtoHash:hash(JSON.stringify(actual))});
    }
    phase="EMPTY_AND_DENIED";const begin=await fence();assert.deepEqual(await source.getProjectMaterialsBatch([],actor("accountant"),tx),[]);nativeCheck(await fence()-begin===1,"THIN_EMPTY_SQL");
    await assert.rejects(source.getProjectMaterialsBatch([ids[0]],actor("accountant"),tx),/Недостаточно прав/);
    phase="CAP_COST_PHASE";const facts=await source.getProjectMaterialsBatch([ids[0],ids[1],ids[19]],actor("admin"),tx);
    nativeCheck(facts[0].movements.length===499&&facts[0].materialsTotalByn===null,"THIN_FULL_HISTORY");
    nativeCheck(!facts[0].movements.some(row=>[prefix+"expense-001",prefix+"latest-income",prefix+"deleted-expense"].includes(row.id)),"THIN_CAP_BEFORE_FILTER");
    nativeCheck(facts[0].lines.length===2&&facts[0].lines.some(row=>row.quantityPerUnit===1.25)&&facts[2].lines.length===0,"THIN_NEEDS_DIRECT");
    nativeCheck(facts[0].warehouseReady===(state?.phase==="ACTIVE"),"THIN_OBSERVED_PHASE");
    phase="ORIGINAL_INSIDE";assert.deepEqual(await nativeSnapshot(tx,ownedKeys),before,"F148_ORIGINAL_INSIDE");
    assert.deepEqual(await tx.warehouseAccountingState.findUnique({where:{id:"main"}}),state,"F148_GLOBAL_WAREHOUSE_CHANGED");nativeCheck(outbound===0,"OUTBOUND");
    report={counts,results,actualPhase:state?.phase??"UNINITIALIZED",activeWacProved:state?.phase==="ACTIVE"||state?.phase==="VERIFYING",fixtureRows:Object.values(manifest.counts).reduce((sum,count)=>sum+count,0),warehouseGlobalUnchanged:true};
    phase="ROLLBACK";throw rollback;
   },{isolationLevel:"RepeatableRead",timeout:120000});}catch(error){rejected=true;if(error!==rollback){failurePhase=phase;throw error;}}
   nativeCheck(report,"THIN_REPORT");return{ok:true,runId:input.runId,target:binding.identity,sourceDigest,mode:"OWNED_ROLLBACK",rolledBack:true,ownedRowsAfter:0,originalDigest:before.digest,originalsEqual:true,outbound,...report};
  },async()=>{
   phase="ORIGINAL_AFTER";const after=await fingerprint(true);afterDigest=after.digest;originalsMatch=after.digest===before.digest;assert.deepEqual(after,before,"F148_ORIGINAL_AFTER");nativeCheck(ownRowsAfter===0,"THIN_OWN_ZERO");sourceMatch=await native148ThinSourceDigest()===sourceDigest;nativeCheck(sourceMatch,"THIN_SOURCE_AFTER");
  });
 }catch(error){
  const value=error as {name?:unknown;code?:unknown;meta?:{code?:unknown};actual?:unknown;expected?:unknown};
  const names=["AssertionError","PrismaClientKnownRequestError","PrismaClientUnknownRequestError","PrismaClientValidationError","AggregateError","Error"];
  throw Object.assign(Error("F148_THIN_HOLD"),{native148Diagnostic:{phase:failurePhase??phase,firstDifference:native148FirstDifference(value.actual,value.expected),partialQueryCounts,errorName:typeof value.name==="string"&&names.includes(value.name)?value.name:"OtherError",prismaCode:typeof value.code==="string"&&/^P\d{4}$/.test(value.code)?value.code:null,sqlState:typeof value.meta?.code==="string"&&/^[A-Z0-9]{5}$/.test(value.meta.code)?value.meta.code:null,actualRows:Array.isArray(value.actual)?value.actual.length:null,expectedRows:Array.isArray(value.expected)?value.expected.length:null,beforeDigest,afterDigest,originalsMatch,sourceMatch,rollbackVerified:rejected&&originalsMatch===true&&ownRowsAfter===0,ownRowsAfter,outbound}});
 }finally{
  globalThis.fetch=originalFetch;if(originalPrisma)(globalThis as{prisma?:PrismaClient}).prisma=originalPrisma;else delete(globalThis as{prisma?:PrismaClient}).prisma;
  await db.$disconnect();
 }
}