import assert from "node:assert/strict";
import {test} from "node:test";
import {taskWorkspaceEligibility,taskReward} from "../src/server/tasks/workspace-contract";
import {matches,queryRows,type FixtureRow} from "./helpers/visibility-fixture";

function fixture(foreignCount=1){
 const projects:FixtureRow[]=[{id:"j",deletedAt:null},{id:"foreign-j",deletedAt:null}];
 const products:FixtureRow[]=[{id:"p",number:"101.1",projectId:"j",project:projects[0],deletedAt:null,tasks:[]},{id:"foreign-p",number:"999.1",projectId:"foreign-j",project:projects[1],deletedAt:null,tasks:[]}];
 const works:FixtureRow[]=products.map((product,index)=>({id:index?"foreign-w":"w",projectId:product.projectId,productId:product.id,project:product.project,product,priceSnapshot:"0"}));
 const tasks:FixtureRow[]=[{id:"own",projectId:"j",productId:"p",workId:"w",assigneeId:"worker",project:projects[0],product:products[0],work:works[0],status:"NEW",title:"Изделие"},...Array.from({length:foreignCount},(_,index)=>({id:"foreign-"+index,projectId:"foreign-j",productId:"foreign-p",workId:"foreign-w",assigneeId:"other",project:projects[1],product:products[1],work:works[1],status:"NEW",title:"Другая задача"}))];
 const observations:{model:string;args:unknown;rows:number}[]=[];
 const db={product:{findMany:async(args:Parameters<typeof queryRows>[1])=>{const rows=queryRows(products,args);observations.push({model:"product",args,rows:rows.length});return rows;}},$queryRaw:async(_strings:TemplateStringsArray,...parameters:unknown[])=>{
  const rows=tasks.filter(task=>{const work=task.work as FixtureRow|null,product=task.product as FixtureRow|null,project=task.project as FixtureRow|null;return work&&product&&project&&task.assigneeId!=null&&work.projectId===task.projectId&&work.productId===task.productId&&product.projectId===task.projectId&&product.deletedAt==null&&project.deletedAt==null&&(work.priceSnapshot!=null||task.allocationGroupId!=null&&task.shareAmount!=null)&&(!parameters[0]||task.projectId===parameters[0])&&(!parameters[2]||task.productId===parameters[2]);}).map(task=>({id:task.id}));
  observations.push({model:"legacy-task-ids",args:parameters,rows:rows.length});return rows;
 }} as unknown as Parameters<typeof taskWorkspaceEligibility>[0];
 const add=(task:FixtureRow)=>{tasks.push(task);for(const product of products)product.tasks=tasks.filter(row=>row.productId===product.id);};
 for(const product of products)product.tasks=tasks.filter(row=>row.productId===product.id);
 return{db,tasks,products,works,projects,observations,add};
}
test("scoped eligibility reads current product coordinates and no Task ID array as foreign tasks grow",async()=>{
 const results=[];
 for(const foreign of [1,10000]){const f=fixture(foreign),where=await taskWorkspaceEligibility(f.db,{projectId:"j",productId:"p"});
  results.push({foreign,ids:f.tasks.filter(row=>matches(row,where as FixtureRow)).map(row=>row.id),legacy:f.observations.filter(row=>row.model==="legacy-task-ids").length,coordinates:f.observations.filter(row=>row.model==="product").reduce((count,row)=>count+row.rows,0),foreignIds:JSON.stringify(where).includes("foreign-")});
 }
 assert.deepEqual(results.map(row=>row.ids),[["own"],["own"]]);
 assert.deepEqual(results.map(row=>row.legacy),[0,0]);
 assert.deepEqual(results.map(row=>row.coordinates),[1,1]);
 assert.deepEqual(results.map(row=>row.foreignIds),[false,false]);
});
test("absent, empty and ambiguous scopes deny before any eligibility read",async()=>{
 for(const scope of [undefined,{}, {projectIds:[]},{projectId:""},{productKey:""},{projectId:"j",productKey:"101.1"}]){
  const f=fixture(),where=await Reflect.apply(taskWorkspaceEligibility,undefined,[f.db,scope]);
  assert.equal(f.observations.length,0);assert.equal(f.tasks.some(row=>matches(row,where as FixtureRow)),false);
 }
});
test("product id-or-number and selected-project predicates preserve result without foreign coordinates",async()=>{
 for(const scope of [{productKey:"p"},{productKey:"101.1"},{projectIds:["j"]}]){
  const f=fixture(),where=await Reflect.apply(taskWorkspaceEligibility,undefined,[f.db,scope]);
  assert.deepEqual(f.tasks.filter(row=>matches(row,where as FixtureRow)).map(row=>row.id),["own"]);
  assert.deepEqual(f.observations.filter(row=>row.model==="product").map(row=>row.rows),[1]);
 }
});
test("priced zero and frozen share keep their bindings while orphan, cross relations and deleted rows stay hidden",async()=>{
 const f=fixture(),base=f.tasks[0],work=f.works[0];
 f.add({...base,id:"frozen",allocationGroupId:"old",shareAmount:"17.89",work:{...work,priceSnapshot:null}});
 for(const[patch,index]of [{productId:null,product:null},{workId:null,work:null},{work:{...work,projectId:"foreign-j"}},{work:{...work,productId:"foreign-p"}},{product:{...f.products[0],projectId:"foreign-j"}},{work:{...work,priceSnapshot:null},allocationGroupId:"old",shareAmount:null}].map((value,index)=>[value,index]as const))f.add({...base,...patch,id:"invalid-"+index});
 const before=f.tasks.map(row=>({id:row.id,shareAmount:row.shareAmount})),where=await taskWorkspaceEligibility(f.db,{projectId:"j"});
 assert.deepEqual(f.tasks.filter(row=>matches(row,where as FixtureRow)).map(row=>row.id),["own","frozen"]);
 assert.deepEqual(f.tasks.map(row=>({id:row.id,shareAmount:row.shareAmount})),before);
 assert.equal(taskReward({quantity:"1",executorShare:"1"},"0","BYN").rewardAmount,"0.00");
 f.products[0].deletedAt=new Date(0);assert.equal(f.tasks.some(row=>matches(row,where as FixtureRow)),false);
});
