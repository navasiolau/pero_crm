import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {createTaskTransaction} from "../src/server/tasks/transaction";
import {warehouseMove} from "../src/server/warehouse/accounting";
import {directStockBaseline} from "./direct-stock-native-scenarios";
import {warehouseTestState} from "./helpers/warehouse-test-state";
export async function runDirectStockHttp(db:PrismaClient,baseUrl:string,allowMissingLocalState=false){
 const before=await directStockBaseline(db),tokenCount=await db.apiToken.count(),marker=`qa104-http-${randomUUID()}`;
 const state=await warehouseTestState(db,marker,allowMissingLocalState),setup=createTaskTransaction(db);
 const ids=[marker,marker+"-manager",marker+"-worker"],tokenIds=[randomUUID(),randomUUID()],tokens=tokenIds.map(()=>`pero_${randomBytes(24).toString("base64url")}`);
 let materialId="",productId="",projectId="",clientId="",sourceId="";
 try{
  await setup(async tx=>{
   for(const [index,role]of (["PROCUREMENT","MANAGER","WORKER"] as const).entries())await tx.user.create({data:{id:ids[index],name:marker,email:ids[index]+"@invalid.local",passwordHash:"qa-login-disabled",roles:[role]}});
   clientId=(await tx.client.create({data:{name:marker,phone:"QA"}})).id;
   const max=await tx.project.aggregate({_max:{numberInt:true}}),number=(max._max.numberInt??0)+1;
   projectId=(await tx.project.create({data:{number:String(number),numberInt:number,title:marker,clientId}})).id;
   productId=(await tx.product.create({data:{number:number+".1",title:marker,projectId,expectedPrice:1000}})).id;
   materialId=(await tx.material.create({data:{name:marker,purchasePrice:0}})).id;
   const actor={id:marker,name:marker,roles:["PROCUREMENT" as const],source:"telegram" as const};
   await warehouseMove(state.wrap(tx),actor,{kind:"INCOME",materialId,quantity:"5",unitPrice:"20",clientMutationId:randomUUID(),comment:marker});
   sourceId=(await warehouseMove(state.wrap(tx),actor,{kind:"EXPENSE",productId,materialId,quantity:"1",clientMutationId:randomUUID(),comment:marker})).movement.id;
   for(const [index,token]of tokens.entries())await tx.apiToken.create({data:{id:tokenIds[index],name:marker,prefix:token.slice(0,11),tokenHash:createHash("sha256").update(token).digest("hex"),scopes:index===0?["read","write"]:["read"],createdById:marker}});
  });
  const request=(method:string,path:string,token:string,actor:string,input?:unknown)=>fetch(baseUrl+"/api/v1/bot/stock-movements"+path,{method,redirect:"manual",headers:{authorization:"Bearer "+token,"x-acting-user":actor,"content-type":"application/json"},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(20000)});
  const input={kind:"EXPENSE",productId,materialId,quantity:"100",clientMutationId:randomUUID()};
  assert.equal((await request("POST","","bad",marker,input)).status,401);
  assert.equal((await request("POST","",tokens[1],marker,input)).status,403);
  assert.equal((await request("POST","",tokens[0],ids[2],input)).status,403);
  const products=await request("GET","?kind=products&q="+encodeURIComponent(marker),tokens[1],marker);
  assert.ok((await products.json()).items.some((item:{id:string})=>item.id===productId));
  const materials=await request("GET","?kind=materials&q="+encodeURIComponent(marker),tokens[1],ids[1]);
  const materialBody=await materials.json();assert.ok(materialBody.items.some((item:{id:string;available:number})=>item.id===materialId&&item.available===4));
  assert.ok(!JSON.stringify(materialBody).includes("purchasePrice"));
  const fresh=await db.warehouseAccountingState.findUnique({where:{id:"main"}});
  for(const [actor,price]of [[marker,"20"],[ids[1],null]] as const){
   const sources=await request("GET","?kind=sources&productId="+productId,tokens[1],actor),body=await sources.json();
   if(fresh?.phase==="ACTIVE")assert.equal(body.items.find((item:{id:string})=>item.id===sourceId).unitPrice,price);
   else assert.deepEqual(body.items,[]);
  }
  const beforeReject=await directStockBaseline(db);
  const over=await request("POST","",tokens[0],marker,input),denied=await over.json();
  assert.equal(denied.ok,false);assert.match(denied.error,fresh?.phase==="ACTIVE"?/Недостаточно материала/:/Склад временно закрыт/);
  const forged=await request("POST","",tokens[0],marker,{...input,quantity:"1",unitPrice:"1"});
  assert.equal((await forged.json()).ok,false);
  assert.deepEqual(await directStockBaseline(db),beforeReject);
  return {status:"PASS",auth:"BEARER_SCOPE_ROLE",directory:"PRODUCT_MATERIAL_SOURCE",costs:state.mode==="REAL_ACTIVE"?"ROLE_REDACTION":"CLOSED_GATE",writes:"REJECTED",providerMessages:0};
 }finally{
  await setup(async tx=>{
   await tx.apiToken.deleteMany({where:{id:{in:tokenIds},name:marker}});
   await tx.warehouseMovementValuation.deleteMany({where:{actorId:marker,movement:{materialId}}});
   await tx.stockMovement.deleteMany({where:{materialId,createdById:marker}});
   if(materialId)await tx.warehouseBalance.deleteMany({where:{materialId}});
   await tx.changeLog.deleteMany({where:{actorId:marker}});await tx.domainEvent.deleteMany({where:{actor:marker}});
   if(materialId)await tx.material.deleteMany({where:{id:materialId,name:marker}});
   if(productId)await tx.product.deleteMany({where:{id:productId,title:marker}});
   if(projectId)await tx.project.deleteMany({where:{id:projectId,title:marker}});
   if(clientId)await tx.client.deleteMany({where:{id:clientId,name:marker}});
   await tx.user.deleteMany({where:{id:{in:ids},name:marker}});
  });
  assert.deepEqual(await directStockBaseline(db),before,"HTTP_ORIGINAL_DATA_CHANGED");assert.equal(await db.apiToken.count(),tokenCount);
 }
}
