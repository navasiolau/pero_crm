// SOURCE_PREPARE148: inert native runner + pure manifest; actual SQL только после reviewed ROOT_GO.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: mismatch/UNKNOWN STOP.
// Actual SQL требует отдельный reviewed protocol + ROOT_GO/exclusive window.
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Prisma,PrismaClient,Role} from "@prisma/client";

export const NATIVE148_RUN_ID="da24fd79-c99f-409a-a72b-4ce662dd19c1";
export type Native148WarehouseState={phase:string;runId:string}|null;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");

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


const native148Root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
function nativeCheck(value:unknown,code:string):asserts value {
 if(!value)throw Error("F148_"+code);
}
const bytesHash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
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

export function native148AssertEngineEnvironment(env:Record<string,string|undefined>){
 for(const key of ["PRISMA_QUERY_ENGINE_LIBRARY","PRISMA_QUERY_ENGINE_BINARY","PRISMA_CLIENT_ENGINE_TYPE"])
  nativeCheck(!env[key],"ENGINE_OVERRIDE");
}

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
