import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire,Module} from "node:module";
import {readFileSync} from "node:fs";
import {PrismaClient,ProductStatus,type Prisma} from "@prisma/client";
import {existingLocalCrmDatabaseUrl} from "./helpers/local-crm-database";
const db=new PrismaClient({datasourceUrl:existingLocalCrmDatabaseUrl()}),require=createRequire(import.meta.url);
let currentTx:Prisma.TransactionClient|null=null;
const filename=require.resolve("../src/lib/prisma"),stub=new Module(filename);
stub.filename=filename;stub.loaded=true;stub.exports={prisma:new Proxy({},{get(_target,key){assert.ok(currentTx,"NATIVE_OUTER_TX_REQUIRED");const value=currentTx[key as keyof Prisma.TransactionClient];return typeof value==="function"?value.bind(currentTx):value;}})};require.cache[filename]=stub;
const products=require("../src/server/products/queries") as typeof import("../src/server/products/queries");
const projects=require("../src/server/projects/queries") as typeof import("../src/server/projects/queries");
const percentages=require("../src/server/product-percentage-pay/queries") as typeof import("../src/server/product-percentage-pay/queries");
const abort=new Error("QA91_ROLLBACK");
async function fingerprint(){
 const rows:Record<string,unknown>={};
 for(const {tablename} of await db.$queryRawUnsafe<{tablename:string}[]>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){
  assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);
  rows[tablename]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${tablename}" t`);
 }
 return rows;
}
async function main(){
 const before=await fingerprint(),checks:string[]=[];
 try{
  await assert.rejects(db.$transaction(async tx=>{
   currentTx=tx;
   // Local находится позади staging: только схема корректировок90 внутри rollback.
   for(const sql of readFileSync(require.resolve("../prisma/migrations/20261007100000_product_percentage_adjustments/migration.sql"),"utf8").split("-- statement-breakpoint"))await tx.$executeRawUnsafe(sql);
   const tag=randomUUID(),actors=await Promise.all((["MANAGER","ENGINEER","WORKER","MOUNTER"] as const).map(role=>tx.user.create({data:{name:`Проверка91 ${role}`,email:`qa91-${tag}-${role}@example.invalid`,passwordHash:"QA91_NO_LOGIN",roles:[role]}})));
   const [manager,engineer,worker,mounter]=actors;
   const client=await tx.client.create({data:{name:"Проверка91",phone:"QA91"}});
   const numberInt=((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1;
   const project=await tx.project.create({data:{number:String(numberInt),numberInt,title:"Проверка91",clientId:client.id,managerId:manager.id,currency:"BYN",initialPrice:"1200",delivery:"20"}});
   const enums=await tx.$queryRawUnsafe<{status:string}[]>('SELECT unnest(enum_range(NULL::"ProductStatus"))::text AS status');
   const statuses=enums.map(row=>row.status).filter((status):status is ProductStatus=>Object.hasOwn(ProductStatus,status));
   const ids=new Map<ProductStatus,string>();
   for(const [index,status] of statuses.entries()){
    const product=await tx.product.create({data:{projectId:project.id,number:`${numberInt}.${index+1}`,suffixInt:index+1,title:"Проверка91",status,engineerId:engineer.id,assemblerId:worker.id,mounterId:mounter.id,expectedPrice:"1000",initialPrice:"1200",quantity:3}});
    ids.set(status,product.id);
    for(const kind of ["ENGINEERING","ASSEMBLY","INSTALLATION"] as const)await tx.productPercentageConfig.create({data:{productId:product.id,kind,ratePercent:"5",revision:1}});
   }
   const engineerRows=await products.listProducts(engineer.id,engineer.roles,{activeOnly:false,projectId:project.id});
   assert.deepEqual(new Set(engineerRows.rows.map(row=>row.status)),new Set(["DESIGN","PRODUCTION"]));
   assert.ok(engineerRows.rows.every(row=>row.expectedPrice===null&&row.initialPrice===null));
   assert.equal((await products.listProducts(engineer.id,engineer.roles,{activeOnly:false,projectId:project.id,engineerId:manager.id})).total,0);
   for(const actor of [worker,mounter]){
    const rows=await products.listProducts(actor.id,actor.roles,{activeOnly:false,projectId:project.id});
    assert.equal(rows.total,statuses.length-1);assert.ok(rows.rows.every(row=>row.status!=="DESIGN"&&row.expectedPrice===null));
    assert.equal(await products.getProductFor(actor.id,actor.roles,ids.get("DESIGN")!),null);
    for(const [status,id] of ids)if(status!=="DESIGN")assert.ok(await products.getProductFor(actor.id,actor.roles,id));
   }
   checks.push("real_filtered_lists_direct_urls_stage_matrix_engineer_field_money_mask");
   const id=ids.get("PRODUCTION")!;
   for(const [index,actor] of [engineer,worker,mounter].entries()){
    const view=await percentages.getProductPercentageView(actor,id,tx),own=(["ENGINEERING","ASSEMBLY","INSTALLATION"] as const)[index];
    for(const [kind,section] of Object.entries(view.sections)){
     for(const field of ["price","unitPrice","productTotal","ratePercent","currentRatePercent"] as const)assert.equal(section[field],null);
     assert.equal(Number(section.total),kind===own?(index===0?50:150):0);
     if(kind!==own)assert.deepEqual(section.members,[]);
    }
   }
   const parent=await projects.getProjectFor(engineer.id,engineer.roles,project.id);
   assert.ok(parent);assert.equal(parent.initialPrice,null);assert.equal(parent.delivery,null);assert.ok(parent.products.every(row=>row.expectedPrice===null&&row.initialPrice===null));
   const parentList=await projects.listProjects(engineer.id,engineer.roles,{activeOnly:false,q:"Проверка91"});
   assert.ok(parentList.rows.every(row=>row.totalPrice===null&&row.products.every(product=>product.expectedPrice===null)));
   assert.equal((await products.getProductFor(manager.id,manager.roles,id))!.expectedPrice!.toString(),"1000");
   checks.push("real_recipient_only_sections_nested_project_projections_and_privileged_money");
   await tx.product.update({where:{id},data:{deletedAt:new Date()}});
   for(const actor of actors)assert.equal(await products.getProductFor(actor.id,actor.roles,id),null);
   checks.push("deleted_product_denied_for_all_roles");
   throw abort;
  },{timeout:120000,maxWait:10000}),error=>error===abort);
  assert.deepEqual(await fingerprint(),before);
  console.log(JSON.stringify({status:"PASS",target:"existing_local_pero_crm_5433",checks,allOriginalRowsMatch:true,persistedRows:0}));
 }finally{currentTx=null;await db.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
