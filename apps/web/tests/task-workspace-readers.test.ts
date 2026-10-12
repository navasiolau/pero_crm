import assert from "node:assert/strict";
import {before,test} from "node:test";
import type {PrismaClient,Role} from "@prisma/client";
import {engineerFixture,fixtureModel,matches,type FixtureRow} from "./helpers/visibility-fixture";

const f=engineerFixture();
for(const [index,task] of f.tasks.entries()){
 task.createdAt=new Date(10000-index*1000);
 const product=task.product as FixtureRow,project=task.project as FixtureRow;
 const work={id:"work-"+task.id,projectId:task.projectId,productId:task.productId,project,product,priceSnapshot:"0",paymentKind:"LEGACY",title:"Работа",quantity:"1",total:"0",tasks:[task]};
 Object.assign(task,{workId:work.id,work,quantity:"1",executorShare:"1"});
 (product.works as FixtureRow[]).push(work);(project.works as FixtureRow[]).push(work);
}
const foreignProject:FixtureRow={...f.projects[1],id:"outside-context",number:"9999",numberInt:9999,products:[],tasks:[],works:[],files:[],stageHistory:[]};
const foreignProduct:FixtureRow={...f.products[1],id:"outside-product",number:"9999.1",projectId:foreignProject.id,project:foreignProject,tasks:[],works:[],files:[]};
const foreignWork:FixtureRow={id:"outside-work",projectId:foreignProject.id,productId:foreignProduct.id,project:foreignProject,product:foreignProduct,priceSnapshot:"1",paymentKind:"LEGACY",title:"Чужая работа",quantity:"10000",total:"10000",tasks:[]};
foreignProject.products=[foreignProduct];foreignProject.works=[foreignWork];foreignProduct.works=[foreignWork];
f.projects.push(foreignProject);f.products.push(foreignProduct);
const observed:{model:string;rows:number;where:unknown}[]=[];
const originalProductFind=f.db.product.findMany;
f.db.product.findMany=async args=>{const rows=await originalProductFind(args);const coordinates=Object.keys(args?.select??{}).sort().join("|")==="id|projectId";observed.push({model:coordinates?"coordinates":"product",rows:rows.length,where:args?.where});return rows;};
const originalGroup=f.db.task.groupBy;
f.db.task.groupBy=async args=>{const rows=await originalGroup(args);observed.push({model:"task-group",rows:rows.length,where:args?.where});return rows;};
const legacy=f.db.$queryRaw;
f.db.$queryRaw=async()=>{const rows=await legacy();observed.push({model:"legacy-task-ids",rows:rows.length,where:null});return rows;};
const db={...f.db,work:fixtureModel(f.projects.flatMap(project=>project.works as FixtureRow[])),orgSetting:{findUnique:async()=>({key:"payrollCurrency",value:"BYN"})}}as unknown as PrismaClient;
let projects:typeof import("../src/server/projects/queries"),products:typeof import("../src/server/products/queries");
before(async()=>{(globalThis as{prisma?:PrismaClient}).prisma=db;projects=await import("../src/server/projects/queries");products=await import("../src/server/products/queries");});
function foreignRows(count:number){
 f.tasks.splice(f.tasks.findIndex(task=>task.id==="outside-0")<0?f.tasks.length:f.tasks.findIndex(task=>task.id==="outside-0"));
 const rows=Array.from({length:count},(_,index):FixtureRow=>({id:"outside-"+index,projectId:foreignProject.id,project:foreignProject,productId:foreignProduct.id,product:foreignProduct,workId:foreignWork.id,work:foreignWork,assigneeId:"other",assignee:{id:"other",name:"Другой"},status:"NEW",title:"Посторонняя",files:[],dependencies:[],quantity:"1",createdAt:new Date(0)}));
 f.tasks.push(...rows);foreignProject.tasks=rows;foreignProduct.tasks=rows;foreignWork.tasks=rows;
}
test("actual project and product cards keep DTO while eligibility does not read foreign Task IDs at1/10000",async()=>{
 const results=[];
 for(const count of[1,10000]){
  foreignRows(count);observed.length=0;
  const project=await projects.getProjectFor("manager",["MANAGER"],"mixed");assert.ok(project);
  const product=await products.getProductFor("manager",["MANAGER"],"own");assert.ok(product);
  results.push({count,projectTasks:project.tasks.map(row=>row.id),productTasks:product.tasks.map(row=>row.id),legacyIds:observed.filter(row=>row.model==="legacy-task-ids").reduce((sum,row)=>sum+row.rows,0),coordinateReads:observed.filter(row=>row.model==="coordinates").map(row=>row.rows)});
 }
 assert.deepEqual(results[0].projectTasks,["task-own","task-foreign","task-production"]);
 assert.deepEqual(results[0].productTasks,["task-own"]);assert.deepEqual(results[1].projectTasks,results[0].projectTasks);assert.deepEqual(results[1].productTasks,results[0].productTasks);
 assert.deepEqual(results.map(row=>row.legacyIds),[0,0]);assert.deepEqual(results.map(row=>row.coordinateReads),[[3,1],[3,1]]);
});
test("actual selected project counts agree with eligible task ACL and every branch aggregates only after final selection",async()=>{
 foreignRows(1);
 for(const options of [
  {filters:{activeOnly:false,q:"mixed"},paging:{page:1,pageSize:10}},
  {filters:{activeOnly:false,sort:"products" as const,dir:"desc" as const},paging:{page:1,pageSize:1}},
  {filters:{activeOnly:false},paging:{page:1,pageSize:1}},
  {filters:{activeOnly:false},paging:undefined},
 ]){
  observed.length=0;const list=await projects.listProjects("manager",["MANAGER"],options.filters,options.paging);
  const selected=new Set(list.rows.map(row=>row.id));assert.ok(selected.size);
  const eligible=new Set((await legacy()).map(row=>row.id));
  for(const row of list.rows)assert.equal(row._count.tasks,f.tasks.filter(task=>task.projectId===row.id&&eligible.has(task.id)).length);
  const coordinates=observed.filter(row=>row.model==="coordinates"),groups=observed.filter(row=>row.model==="task-group");
  assert.equal(coordinates.length,1);assert.equal(groups.length,1);
  const selection=(coordinates[0].where as {AND:{projectId?:{in:string[]}}[]}).AND.find(where=>where.projectId)?.projectId?.in;
  assert.deepEqual(selection,[...selected]);
  const included=f.tasks.filter(task=>matches(task,groups[0].where as FixtureRow));assert.ok(included.every(task=>selected.has(String(task.projectId))));
  assert.equal(observed.some(row=>row.model==="legacy-task-ids"),false);
 }
 observed.length=0;const empty=await projects.listProjects("manager",["MANAGER"],{activeOnly:false,q:"missing-project"},{page:1,pageSize:10});
 assert.equal(empty.rows.length,0);assert.equal(observed.some(row=>row.model==="coordinates"||row.model==="task-group"),false);
});
test("card ACL and historical fields are preserved across allowed role unions",async()=>{
 for(const roles of[["ENGINEER"],["ENGINEER","ACCOUNTANT"],["WORKER","ENGINEER"],["MANAGER","ENGINEER"],["PROCUREMENT"]]as Role[][]){
  const before=f.db.payrollEntry;const project=await projects.getProjectFor("engineer",roles,"mixed");assert.ok(project);assert.equal(f.db.payrollEntry,before);
  if(roles.includes("MANAGER")||roles.includes("PROCUREMENT"))assert.equal(project.tasks.length,3);else assert.equal(project.tasks.some(task=>task.id==="task-foreign"),false);
 }
 assert.equal(await projects.getProjectFor("engineer",["ACCOUNTANT"],"mixed"),null);
});
