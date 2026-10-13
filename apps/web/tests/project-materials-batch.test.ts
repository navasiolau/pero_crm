import assert from "node:assert/strict";
import {before, test} from "node:test";
import {createRequire, Module} from "node:module";
import {Prisma, type Role} from "@prisma/client";
import {fixtureModel, matches, queryRows, type FixtureRow} from "./helpers/visibility-fixture";
import type {VisibilityActor} from "../src/server/access/visibility";
import type {ProjectMaterialsData} from "../src/server/warehouse/contracts";
import {frozenGetProjectMaterials} from "./helpers/project-materials-reference";
const require = createRequire(import.meta.url);
type Query = NonNullable<Parameters<typeof queryRows>[1]>;
type BatchReader = (ids:readonly string[],actor:VisibilityActor,database?:Prisma.TransactionClient)=>Promise<ProjectMaterialsData[]>;
let queries:typeof import("../src/server/warehouse/queries") & {getProjectMaterialsBatch?:BatchReader};

/** Локальная relational fixture: никаких соединений, callbacks или бизнес-записей. */
function fixture(phase:"ACTIVE"|"VERIFYING"|"UNINITIALIZED"="ACTIVE",unknownCost=false){
 const calls:string[]=[];
 const material:FixtureRow={id:"material",name:"Архивная ЛДСП",sku:"legacy-sku",active:false,purchasePrice:"9.99",measurementUnit:{name:"лист"}};
 const projects:FixtureRow[]=[{id:"project",deletedAt:null},{id:"deleted-project",deletedAt:new Date(1)}];
 const products:FixtureRow[]=Array.from({length:20},(_,index)=>({
  id:"product-"+(index+1),number:"P"+(index+1),deletedAt:index===2?new Date(1):null,
  project:index===3?projects[1]:projects[0],projectId:index===3?"deleted-project":"project",
  engineerId:index<2?"engineer":"foreign",status:index===1?"PRODUCTION":index===4?"DRAFT":"DESIGN",
 }));
 const needs:FixtureRow[]=products.filter(row=>row.id!=="product-20").map((product,index)=>({
  id:"need-"+product.id,productId:product.id,product,materialId:material.id,material,
  quantity:index===0?"5":index===1?"7":"2",quantityPerUnit:"0.125",
  issuedQty:index===0?"4":index===1?"2":"0",comment:index===0?"Историческая выдача":null,createdAt:new Date(index),
 }));
 const movements:FixtureRow[]=[];
 function movement(product:FixtureRow,id:string,type:"EXPENSE"|"RETURN"|"INCOME",at:number,total:string|null,quantity="0.001"){
  const row:FixtureRow={id,productId:product.id,product,materialId:material.id,material,type,
   receiptKind:type==="INCOME"?"PAID":null,quantity,unitPrice:"1",totalByn:total,
   deletionId:null,comment:null,createdById:id==="history-1"?"missing-author":"engineer",createdAt:new Date(at)};
  movements.push(row);return row;
 }
 for(let index=1;index<=501;index++)movement(products[0],"history-"+index,"EXPENSE",index,index===1&&unknownCost?null:index===501?"3":"1",index===501?"3":"0.001");
 movement(products[0],"partial-return","RETURN",650,"2","2");
 movement(products[0],"latest-income","INCOME",9999,"7","7");
 const deleted=movement(products[0],"deleted-movement","EXPENSE",10000,"999","999");deleted.deletionId="deleted-operation";
 for(let index=1;index<products.length;index++)movement(products[index],"movement-"+products[index].id,"EXPENSE",700+index,"1","1");
 const p1Source=movements.find(row=>row.id==="history-501")!;
 const p2Source=movements.find(row=>row.id==="movement-product-2")!;
 const directSource=movements.find(row=>row.id==="movement-product-20")!;
 const valuations:FixtureRow[]=[{id:"v2",movementId:p2Source.id,movement:p2Source,runId:"run",quantity:new Prisma.Decimal("1"),returnedQuantity:new Prisma.Decimal("0.5"),unitCost:new Prisma.Decimal("1")},
  {id:"v1",movementId:p1Source.id,movement:p1Source,runId:"run",quantity:new Prisma.Decimal("3"),returnedQuantity:new Prisma.Decimal("2"),unitCost:new Prisma.Decimal("1")},
  {id:"v20",movementId:directSource.id,movement:directSource,runId:"run",quantity:new Prisma.Decimal("1"),returnedQuantity:new Prisma.Decimal("0"),unitCost:new Prisma.Decimal("1")}];
 const balances:FixtureRow[]=[{materialId:material.id,quantity:"2",valueByn:"5",runId:"run"}];
 const traced=(name:string,rows:FixtureRow[])=>{
  const model=fixtureModel(rows);
  return {...model,findMany:async(query:Query={})=>{calls.push(name+".findMany");return queryRows(rows,query);}};
 };
 const db={
  product:traced("product",products),projectMaterial:traced("projectMaterial",needs),
  task:traced("task",[]),productPercentageParticipant:traced("productPercentageParticipant",[]),
  user:traced("user",[{id:"engineer",name:"Инженер"}]),stockPurchase:traced("stockPurchase",[]),
  warehouseAccountingState:{findUnique:async()=>{calls.push("warehouseAccountingState.findUnique");return {phase,runId:"run"};}},
  warehouseBalance:traced("warehouseBalance",balances),
  warehouseMovementValuation:{findMany:async(query:Query={})=>{
   calls.push("warehouseMovementValuation.findMany");
   return queryRows(valuations,query).map(row=>{
    const source=valuations.find(value=>value.id===row.id)!;
    return {...row,quantity:source.quantity,returnedQuantity:source.returnedQuantity,unitCost:source.unitCost};
   });
  }},
  stockMovement:{...traced("stockMovement",movements),groupBy:async(query:Query={})=>{
   calls.push("stockMovement.groupBy");const groups=new Map<string,{materialId:string;type:string;_sum:{quantity:Prisma.Decimal}}>();
   for(const row of movements.filter(value=>matches(value,query.where))){
    const key=String(row.materialId)+":"+row.type;
    const group=groups.get(key)??{materialId:String(row.materialId),type:String(row.type),_sum:{quantity:new Prisma.Decimal(0)}};
    group._sum.quantity=group._sum.quantity.plus(String(row.quantity));groups.set(key,group);
   }return [...groups.values()];
  }},
  // Это faithful in-memory rank adapter; PostgreSQL grammar/plans/actual query count он НЕ доказывает.
  $queryRaw:async(query:Prisma.Sql)=>{
   calls.push("$queryRaw");
   assert.ok(Array.isArray(query.values),"Параметризованный query object обязателен");
   const ids=new Set(query.values.filter((value:unknown)=>typeof value==="string"&&products.some(row=>row.id===value)));
   if(query.text.includes('"ProjectMaterial"'))return products.flatMap(product=>ids.has(product.id)?queryRows(needs,{where:{productId:product.id},orderBy:{createdAt:"asc"},select:{id:true}}):[]);
   return products.flatMap(product=>ids.has(product.id)?queryRows(movements,{where:{productId:product.id,deletionId:null},orderBy:[{createdAt:"desc"},{id:"desc"}],take:500,select:{id:true}}):[]);
  },
 };
 return {db:db as unknown as Prisma.TransactionClient,calls,products,needs,movements,valuations,
  fingerprint:()=>JSON.stringify({products,needs,movements,valuations,balances,phase})};
}
before(()=>{
 const filename=require.resolve("../src/lib/prisma"),stub=new Module(filename);
 stub.filename=filename;stub.loaded=true;stub.exports={prisma:fixture().db};require.cache[filename]=stub;
 queries=require("../src/server/warehouse/queries");
});
function batch():BatchReader{
 assert.equal(typeof queries.getProjectMaterialsBatch,"function","Пакетный reader отсутствует");
 return queries.getProjectMaterialsBatch!;
}
const actor=(roles:Role[]=["ADMIN"]):VisibilityActor=>({id:"engineer",roles});

// Frozen cd38 reader + formatter; source SHA256 24a428a52659afa54596d5b03df9c5549f8be2ed7d0ffb3e67244da4b94a532d.
// Это независимый pre-change oracle, а не новый scalar wrapper. Grants/Decimal/WAC helpers остаются каноническими.
test("frozen baseline demonstrates repeated reads and preserves the full 501-entry cost history",async()=>{
 const one=fixture(),many=fixture();
 const baseline=await frozenGetProjectMaterials("product-1",actor(),one.db);
 assert.equal(baseline.movements.length,499);
 assert.equal(baseline.movements.some(row=>row.id==="history-1"),false);
 assert.equal(baseline.movements.some(row=>row.id==="latest-income"||row.id==="deleted-movement"),false);
 assert.equal(baseline.materialsTotalByn,501);
 assert.equal(baseline.lines[0].purchasePrice,2.5);
 assert.equal(baseline.lines[0].legacyReturnQuantity,3);
 for(const product of many.products)await frozenGetProjectMaterials(String(product.id),actor(),many.db);
 assert.ok(many.calls.length>one.calls.length+2,"Baseline действительно повторяет domain reads для каждого изделия");
});
test("batch1/5/20 and scalar match the frozen reference with a fixed read budget",async(context)=>{
 const read=batch(),counts:number[]=[];
 for(const size of [1,5,20]){
  const control=fixture(),current=fixture(),ids=current.products.slice(0,size).map(row=>String(row.id)),before=current.fingerprint();
  const expected=await Promise.all(ids.map(id=>frozenGetProjectMaterials(id,actor(),control.db)));
  const actual=await read(ids,actor(),current.db);
  assert.deepEqual(actual,expected);assert.equal(current.fingerprint(),before);counts.push(current.calls.length);
  const single=fixture();assert.deepEqual(await queries.getProjectMaterials(ids[0],actor(),single.db),expected[0]);
 }
 context.diagnostic(JSON.stringify({level:"memory-model",products:[1,5,20],readCalls:counts}));
 assert.ok(counts[2]<=counts[0]+2,JSON.stringify({counts}));
});
test("empty and duplicate/cross-project inputs keep positional DTO and do not expand OFFICE grants",async()=>{
 const read=batch(),empty=fixture();
 assert.deepEqual(await read([],actor(["ACCOUNTANT"]),empty.db),[]);assert.equal(empty.calls.length,0);
 for(const roles of [["ADMIN"],["DIRECTOR"],["MANAGER"],["ENGINEER"],["PROCUREMENT"],["MANAGER","ACCOUNTANT"]] as Role[][]){
  const control=fixture(),current=fixture(),ids=["product-2","product-1","product-2","product-20","missing"];
  assert.deepEqual(await read(ids,actor(roles),current.db),await Promise.all(ids.map(id=>frozenGetProjectMaterials(id,actor(roles),control.db))),roles.join("+"));
 }
 for(const roles of [["ACCOUNTANT"],["WORKER"]] as Role[][]){
  const current=fixture();await assert.rejects(read(["product-1"],actor(roles),current.db),/Недостаточно прав/);assert.equal(current.calls.length,0);
 }
});
test("independent movement grants retain ADMIN/DIRECTOR deleted product/project history and deny ordinary roles",async()=>{
 const read=batch(),ids=["product-3","product-4"];
 for(const role of ["ADMIN","DIRECTOR","ENGINEER","PROCUREMENT"] as Role[]){
  const control=fixture(),current=fixture(),result=await read(ids,actor([role]),current.db);
  assert.deepEqual(result,await Promise.all(ids.map(id=>frozenGetProjectMaterials(id,actor([role]),control.db))));
  for(const item of result){
   assert.deepEqual(item.lines,[]);assert.deepEqual(item.returnSources,[]);
   assert.equal(item.movements.length,role==="ADMIN"||role==="DIRECTOR"?1:0);
  }
 }
});
test("current/VERIFYING/legacy phases, archived issued quantities, nullable costs and role masks keep the exact old values",async()=>{
 const read=batch();
 for(const phase of ["ACTIVE","VERIFYING","UNINITIALIZED"] as const){
  for(const roles of [["ADMIN"],["ENGINEER"],["MANAGER"],["MANAGER","ACCOUNTANT"]] as Role[][]){
   const control=fixture(phase,true),current=fixture(phase,true),ids=["product-1","product-2","product-20"],before=current.fingerprint();
   const result=await read(ids,actor(roles),current.db);
   assert.deepEqual(result,await Promise.all(ids.map(id=>frozenGetProjectMaterials(id,actor(roles),control.db))));
   assert.equal(result[0].materialsTotalByn,null);assert.equal(result[0].warehouseReady,phase==="ACTIVE");
   assert.equal(current.fingerprint(),before);
   if(!roles.includes("ADMIN")&&!roles.includes("ACCOUNTANT")){
    for(const group of result){
     assert.ok(group.lines.every(row=>row.purchasePrice===null));
     assert.ok(group.returnSources.every(row=>row.unitPrice===null));
     assert.ok(group.movements.every(row=>row.unitPrice===null&&row.totalByn===null&&row.reportDocument===null));
    }
   }
  }
 }
});

test("controlled multi-material/equal-timestamp DTO ordering and movement tie IDs stay equal to the old reader",async()=>{
 const read=batch(),control=fixture(),current=fixture(),ids=["product-1","product-2"];
 for(const data of [control,current]){
  const first=data.needs.find(row=>row.productId==="product-1")!;
  const secondMaterial={id:"second-material",name:"Вторая номенклатура",sku:null,purchasePrice:"12.34",measurementUnit:{name:"м"},active:true};
  data.needs.push({...first,id:"equal-time-need",materialId:secondMaterial.id,material:secondMaterial,quantity:"1.25",quantityPerUnit:null,issuedQty:"1.2",comment:"Не менять порядок",createdAt:first.createdAt});
  const source=data.movements.find(row=>row.productId==="product-2")!;
  for(const id of ["tie-movement-a","tie-movement-z"])data.movements.push({...source,id,createdAt:new Date(900),totalByn:"0.01"});
 }
 const expected=await Promise.all(ids.map(id=>frozenGetProjectMaterials(id,actor(),control.db)));
 const actual=await read(ids,actor(),current.db);
 assert.deepEqual(actual,expected);
 assert.deepEqual(actual[0].lines.map(row=>row.id),["need-product-1","equal-time-need"]);
 assert.deepEqual(actual[1].movements.slice(0,2).map(row=>row.id),["tie-movement-z","tie-movement-a"]);
 assert.equal(actual[0].lines[1].quantityPerUnit,1.25);
 assert.equal(actual[0].lines[1].legacyReturnQuantity,1.2);
 assert.equal(actual[0].hasShortage,true);
 // Это controlled fixture order. Реальный PostgreSQL equal-timestamp order проверяется separately native.
});


test("native148 rejects runtime engine overrides before any constructor",async()=>{
 const native=await import("./project-materials-batch-native");
 assert.doesNotThrow(()=>native.native148AssertEngineEnvironment({}));
 for(const key of ["PRISMA_QUERY_ENGINE_LIBRARY","PRISMA_QUERY_ENGINE_BINARY","PRISMA_CLIENT_ENGINE_TYPE"])
  assert.throws(()=>native.native148AssertEngineEnvironment({[key]:"unowned-engine"}),/F148_ENGINE_OVERRIDE/);
});
