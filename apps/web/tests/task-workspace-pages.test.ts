import assert from "node:assert/strict";
import {before,test} from "node:test";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import type {PrismaClient,Role} from "@prisma/client";
import {engineerFixture,fixtureModel,type FixtureRow} from "./helpers/visibility-fixture";

const require=createRequire(import.meta.url);
type Plugin={onResolve:(options:{filter:RegExp},callback:(args:{path:string})=>{path:string;namespace:string}|null)=>void;onLoad:(options:{filter:RegExp;namespace:string},callback:(args:{path:string})=>{contents:string;loader:"js"})=>void};
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild") as {build:(options:{entryPoints:string[];absWorkingDir:string;bundle:boolean;write:boolean;format:"cjs";platform:"node";target:string;logLevel:"silent";jsx:"automatic";external:string[];plugins:{name:string;setup:(plugin:Plugin)=>void}[]})=>Promise<{outputFiles:{text:string}[]}>};
const f=engineerFixture(),project=f.projects[0],product=f.products[0];
product.status="PRODUCTION";
for(const item of f.projects)item.stage="IN_WORK";
const work:FixtureRow={id:"page-work",projectId:project.id,productId:product.id,project,product,priceSnapshot:"0",paymentKind:"LEGACY",title:"Работа",quantity:"1000",total:"0",tasks:[]};
project.works=[work];product.works=[work];
const today=new Date();today.setHours(12,0,0,0);
const tomorrow=new Date(today);tomorrow.setDate(today.getDate()+1);
const base:FixtureRow={projectId:project.id,project,productId:product.id,product,workId:work.id,work,assigneeId:"worker",assignee:{id:"worker",name:"Сотрудник"},title:"Поиск 147",status:"NEW",quantity:"1",executorShare:"1",files:[],dependencies:[],dueAt:today,createdAt:today,updatedAt:today};
const observations:{model:string;query:unknown;rows:number}[]=[];
const probe={actor:{id:"worker",roles:["WORKER"] as Role[],name:"Сотрудник"},timerCalls:0,preferenceCalls:0,workersCalls:0,queries:{} as typeof import("../src/server/tasks/queries")};
const db={...f.db,work:fixtureModel([work]),orgSetting:{findUnique:async()=>({key:"payrollCurrency",value:"BYN"})}};
const productFind=f.db.product.findMany;
db.product.findMany=async args=>{const rows=await productFind(args as Parameters<typeof productFind>[0]);observations.push({model:"product",query:args,rows:rows.length});return rows;};
const taskFind=f.db.task.findMany;
db.task.findMany=async args=>{const rows=await taskFind(args as Parameters<typeof taskFind>[0]);observations.push({model:"task",query:args,rows:rows.length});return rows;};
const taskCount=f.db.task.count;
db.task.count=async args=>{const count=await taskCount(args as Parameters<typeof taskCount>[0]);observations.push({model:"task-count",query:args,rows:count});return count;};
const legacy=f.db.$queryRaw;
db.$queryRaw=async()=>{const rows=await legacy();observations.push({model:"legacy-task-ids",query:null,rows:rows.length});return rows;};
function rows(count=330){
 f.tasks.length=0;
 f.tasks.push(...Array.from({length:count},(_,index)=>({...base,id:"own-"+index,status:index<15?"DONE":"NEW",createdAt:new Date(today.getTime()-index*1000),updatedAt:new Date(today.getTime()-index*1000)})));
 project.tasks=f.tasks;product.tasks=f.tasks;work.tasks=f.tasks;
 observations.length=0;probe.timerCalls=0;probe.preferenceCalls=0;probe.workersCalls=0;
}
before(async()=>{(globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;probe.queries=await import("../src/server/tasks/queries");});
async function actualPage(entry:string){
 const stubs:Record<string,string>={
  "@/auth":"export async function auth(){return {user:globalThis.__pageProbe.actor}}",
  "@/lib/prisma":"export const prisma=globalThis.__pageDatabase",
  "next/navigation":"export function redirect(path){throw Object.assign(Error('REDIRECT'),{path})}",
  "next/server":"export const NextResponse={json:(body,init)=>new Response(JSON.stringify(body),{status:init?.status??200,headers:{'content-type':'application/json'}})}",
  "react/jsx-runtime":"export const Fragment='Fragment';export const jsx=(type,props)=>({type:typeof type==='function'?type.name:type,props});export const jsxs=jsx",
  "@/server/tasks/queries":"export const taskWorkspaceWhere=(...args)=>globalThis.__pageProbe.queries.taskWorkspaceWhere(...args);export const taskDetailsIncludeFor=(...args)=>globalThis.__pageProbe.queries.taskDetailsIncludeFor(...args);export const mapTaskDetails=(...args)=>globalThis.__pageProbe.queries.mapTaskDetails(...args)",
  "@/server/preferences":"export async function getUserPreference(){globalThis.__pageProbe.preferenceCalls++;return 'kanban'}",
  "@/server/time/actions":"export async function getActiveTimer(){globalThis.__pageProbe.timerCalls++;return null}",
  "@/server/projects/queries":"export async function listWorkers(){globalThis.__pageProbe.workersCalls++;return [{id:'worker',name:'Сотрудник',position:null}]}",
  "./my-tasks-view":"export function MyTasksView(){}",
  "./tasks-page-view":"export function TasksPageView(){}",
  "@/components/chart-area-interactive":"export function ChartAreaInteractive(){}",
  "@/components/plugins/plugin-slot":"export function PluginSlot(){}",
  "@/components/recent-projects":"export function RecentProjects(){}",
  "@/components/section-cards":"export function SectionCards(){}",
 };
 const output=await build({entryPoints:[resolve(entry)],absWorkingDir:process.cwd(),bundle:true,write:false,format:"cjs",platform:"node",target:"node22",logLevel:"silent",jsx:"automatic",external:["@prisma/client"],plugins:[{name:"inert-page-effects",setup(plugin){plugin.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:"page-fixture"}:null);plugin.onLoad({filter:/.*/,namespace:"page-fixture"},args=>({contents:stubs[args.path],loader:"js"}));}}]});
 const fixture={exports:{}};runInNewContext(output.outputFiles[0].text,{module:fixture,exports:fixture.exports,require,Response,URL,Date,__pageProbe:probe,__pageDatabase:db},{timeout:1000});
 return fixture.exports as {default:()=>Promise<{props:FixtureRow}>;GET:(request:Request)=>Promise<Response>};
}
test("actual my/global pages preserve order, take100/300, done10, mapper and inert effect calls with explicit eligibility scope",async()=>{
 rows();probe.actor={id:"worker",roles:["WORKER"],name:"Сотрудник"};
 const my=await actualPage("src/app/(app)/my/page.tsx"),node=await my.default();
 const myQuery=observations.find(row=>row.model==="task"&&!!(row.query as FixtureRow).take)?.query as FixtureRow;
 assert.equal(myQuery.take,100);assert.deepEqual(JSON.parse(JSON.stringify(myQuery.orderBy)),[{status:"asc"},{dueAt:"asc"},{createdAt:"desc"}]);
 assert.equal((node.props.done as FixtureRow[]).length,10);assert.equal((node.props.active as FixtureRow[]).length,85);
 assert.equal(probe.timerCalls,1);assert.equal(probe.preferenceCalls,1);
 observations.length=0;probe.actor={id:"manager",roles:["MANAGER"],name:"Менеджер"};
 const global=await actualPage("src/app/(app)/tasks/page.tsx"),all=await global.default();
 const globalQuery=observations.find(row=>row.model==="task"&&!!(row.query as FixtureRow).take)?.query as FixtureRow;
 assert.equal(globalQuery.take,300);assert.deepEqual(JSON.parse(JSON.stringify(globalQuery.orderBy)),JSON.parse(JSON.stringify(myQuery.orderBy)));assert.equal((all.props.tasks as FixtureRow[]).length,300);assert.equal(probe.workersCalls,1);
 assert.equal(observations.some(row=>row.model==="legacy-task-ids"),false);
});
test("actual dashboard preserves organization count including old DRAFT policy, nonDONE/deadline and original home-role guard",async()=>{
 rows(1);f.tasks[0].status="NEW";
 f.tasks.push({...base,id:"draft",status:"DRAFT",assigneeId:"other"},{...base,id:"future",dueAt:tomorrow},{...base,id:"null-date",dueAt:null},{...base,id:"closed",status:"DONE"});
 probe.actor={id:"manager",roles:["MANAGER"],name:"Менеджер"};
 const page=await actualPage("src/app/(app)/page.tsx"),node=await page.default();
 const count=observations.find(row=>row.model==="task-count");assert.equal(count?.rows,2);
 const children=node.props.children as {type:string;props:FixtureRow}[];
 assert.equal(((children.find(child=>child.type==="SectionCards")?.props.cards) as FixtureRow[])[1].value,"2");
 const legacyRead=observations.some(row=>row.model==="legacy-task-ids");
 observations.length=0;probe.actor={id:"worker",roles:["WORKER"],name:"Сотрудник"};
 await assert.rejects(page.default(),error=>(error as Error&{path?:string}).path==="/my");assert.equal(observations.length,0);
 assert.equal(legacyRead,false);
});
test("global page denies field-only role before eligibility and role union keeps office gate",async()=>{
 rows();const page=await actualPage("src/app/(app)/tasks/page.tsx");
 for(const roles of [["WORKER"],["MOUNTER"]] as Role[][]){probe.actor={id:"worker",roles,name:"Сотрудник"};observations.length=0;await assert.rejects(page.default(),error=>(error as Error&{path?:string}).path==="/my");assert.equal(observations.length,0);}
 probe.actor={id:"manager",roles:["MANAGER","ENGINEER"],name:"Менеджер"};const result=await page.default();assert.equal((result.props.tasks as FixtureRow[]).length,300);
});
test("actual search keeps six ordered eligible matches after earlier orphan rows and excludes nonmatching foreign coordinates",async()=>{
 rows(12);for(const task of f.tasks)task.status="NEW";
 const foreignProject:FixtureRow={id:"search-foreign",number:"999",deletedAt:null},foreignProduct:FixtureRow={id:"search-foreign-product",projectId:"search-foreign",project:foreignProject,deletedAt:null,tasks:[]};
 const foreignWork:FixtureRow={id:"search-foreign-work",projectId:foreignProject.id,productId:foreignProduct.id,project:foreignProject,product:foreignProduct,priceSnapshot:"1"};
 f.products.push(foreignProduct);f.projects.push(foreignProject);
 f.tasks.unshift({...base,id:"orphan-before",work:null,workId:null,updatedAt:new Date(today.getTime()+1000)});
 for(let index=0;index<10000;index++)f.tasks.push({...base,id:"unmatched-"+index,title:"Другая область",projectId:foreignProject.id,project:foreignProject,productId:foreignProduct.id,product:foreignProduct,workId:foreignWork.id,work:foreignWork});
 foreignProduct.tasks=f.tasks.filter(task=>task.productId===foreignProduct.id);
 probe.actor={id:"manager",roles:["MANAGER"],name:"Менеджер"};
 const route=await actualPage("src/app/api/search/route.ts"),response=await route.GET(new Request("https://fixture.test/api/search?q=%20Поиск%20147%20")),body=await response.json() as {tasks:{id:string}[]};
 assert.equal(response.status,200);assert.deepEqual(body.tasks.map(row=>row.id),Array.from({length:6},(_,index)=>"own-"+index));
 const taskQuery=observations.find(row=>row.model==="task"&&(row.query as FixtureRow).take===6)?.query as FixtureRow;
 assert.deepEqual(JSON.parse(JSON.stringify(taskQuery.orderBy)),{updatedAt:"desc"});
 assert.equal(observations.some(row=>row.model==="legacy-task-ids"),false);
 assert.equal(observations.filter(row=>row.model==="product"&&Object.keys((row.query as FixtureRow).select as FixtureRow??{}).join("|")==="id|projectId").reduce((sum,row)=>sum+row.rows,0),1);
 observations.length=0;const short=await route.GET(new Request("https://fixture.test/api/search?q=1"));assert.deepEqual(await short.json(),{projects:[],products:[],tasks:[],clients:[]});assert.equal(observations.length,0);
});
