import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptsQuantityDraft, stepQuantityDraft, productDraftTotal } from "../src/lib/product-quantity-input";
import { createInlineSaveController, type InlineSaveController, type InlineValue } from "../src/lib/inline-save-controller";
import { confirmedProductClientContacts } from "../src/lib/product-client-contacts";
import { productPatchSchema } from "../src/server/products/patch-contract";
import { submitClientEditor } from "../src/lib/client-editor-submit";
import { type ProductStatus, type Role, type Prisma } from "@prisma/client";
import { PRODUCT_STATUSES, productStatusLabels, productStatusStyles } from "../src/lib/product-statuses";
import { decideProductPercentageStatus, percentageCompletionKinds } from "../src/lib/product-percentage-status";
import { productVisibilityWhere, projectVisibilityWhere, taskVisibilityWhere, taskExecutionWhere, fileVisibilityWhere, productEditWhere, workVisibilityWhere } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";
import { flushProductStatusBarrier } from "../src/lib/product-status-barrier";
import { createSinglePercentageControllers } from "../src/lib/single-percentage-controller";
import { productStatusTargets } from "../src/lib/product-percentage-ui";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { setProductNoModelCore } from "../src/server/product-percentage-pay/core";

// Источник: product-quantity-input.test.ts
test('integer spinner rejects exponent/fraction/sign, defaults empty to1 and clamps without fractional drift',()=>{
 for(const bad of ['1e2','1.5','+1','-1','1,5',' 1','１２','12345678901'])assert.equal(acceptsQuantityDraft(bad),false);
 assert.equal(stepQuantityDraft('',1),'1');assert.equal(stepQuantityDraft('',-1),'1');assert.equal(stepQuantityDraft('1',-1),'1');assert.equal(stepQuantityDraft('3',1),'4');assert.equal(stepQuantityDraft('2147483647',1),'2147483647');assert.equal(stepQuantityDraft('1.5',1),null);
});
test('draft sum is exact unit price×integer count, NULL neverzero and invalid drafts stay unknown',()=>{
 assert.equal(productDraftTotal('12.34','4'),'49.36');assert.equal(productDraftTotal('12,34','3'),'37.02');assert.equal(productDraftTotal('0','3'),'0.00');assert.equal(productDraftTotal('','3'),null);assert.equal(productDraftTotal('12.34',''),null);assert.equal(productDraftTotal('12.34','0'),null);assert.equal(productDraftTotal('12.34','1e2'),null);assert.equal(productDraftTotal('12.345','3'),null);assert.equal(productDraftTotal('9999999999.99','2'),null);
});
test('stepped quantity commit preserves actual controller baseline/UUID after lost ACK',async()=>{
 const calls:{value:number;expectedValue:number;clientMutationId:string}[]=[];let fail=true;
 const control=createInlineSaveController<number>({initialValue:1,format:String,parse:value=>{const n=Number(value);if(!acceptsQuantityDraft(value)||!value||n<1||n>2147483647)throw Error('quantity');return n;},save:async input=>{calls.push(input);if(fail)throw Error('lost ACK');return{kind:'saved',value:input.value,clientMutationId:input.clientMutationId};}});
 control.setDraft(stepQuantityDraft(control.getSnapshot().draft,1)!);assert.equal(await control.commit(),false);assert.equal(calls[0].value,2);assert.equal(calls[0].expectedValue,1);fail=false;assert.equal(await control.retry(),true);assert.deepEqual(calls[0],calls[1]);assert.equal(control.getSnapshot().baseline,2);
 control.setDraft('');assert.equal(await control.commit(),false);assert.equal(calls.length,2);
});
test('older step ACK does not erase newer quantity draft or readonly draft sum',async()=>{
 let release!:(result:{kind:'saved';value:number;clientMutationId:string})=>void;let request!:{value:number;expectedValue:number;clientMutationId:string};
 const control=createInlineSaveController<number>({initialValue:1,format:String,parse:Number,save:input=>{request=input;return new Promise(done=>{release=done;});}});
 control.setDraft('2');const saving=control.commit();await new Promise(done=>setTimeout(done,0));control.setDraft(stepQuantityDraft(control.getSnapshot().draft,1)!);release({kind:'saved',value:request.value,clientMutationId:request.clientMutationId});await saving;assert.equal(control.getSnapshot().draft,'3');assert.equal(control.getSnapshot().baseline,2);assert.equal(control.getSnapshot().status,'dirty');assert.equal(productDraftTotal('12.34',control.getSnapshot().draft),'37.02');
});

// Источник: product-client-layout.test.ts
test("confirmed selected Client supplies contacts; stale draft/project address cannot substitute",()=>{
 const clients=[{id:"a",label:"A",phone:"100",address:"Client A"},{id:"b",label:"B",phone:"200",address:"Client B"}];
 assert.equal(confirmedProductClientContacts("b",clients,{clientId:"a",phone:"100",clientAddress:"stale"}).address,"Client B");
 assert.equal(confirmedProductClientContacts("new",clients,{clientId:"new",phone:"300",clientAddress:null,clientLabel:"Created"}).phone,"300");
 assert.equal(confirmedProductClientContacts("unknown",clients,{clientId:"a",phone:"100",clientAddress:"Project old"}).known,false);
});
test("retired Product phone/address requests fail closed while client selection still uses CAS",()=>{
 const base={productId:"product",clientMutationId:"00000000-0000-4000-8000-000000000001",expectedValue:"old",value:"new"};
 assert.equal(productPatchSchema.safeParse({...base,field:"project.address"}).success,false);
 assert.equal(productPatchSchema.safeParse({...base,field:"client.phone",expectedClientId:"client"}).success,false);
 assert.equal(productPatchSchema.safeParse({...base,field:"project.clientId"}).success,true);
});
test("shared real CRUD adapter creates once and preserves exact rendered client update baseline",async()=>{
 let created=0,updated=0;const input={name:"New",phone:"100",address:"Address"};let captured:unknown;
 const actions={create:async()=>{created++;return{ok:true,id:"actual-client"}},update:async(_id:string,_input:unknown,baseline:unknown)=>{updated++;captured=baseline;return{ok:true}}};
 assert.equal((await submitClientEditor(input,null,actions)).id,"actual-client");assert.equal(created,1);assert.equal(updated,0);
 const initial={id:"old",name:"Old",phone:"200",lastName:null,middleName:null,email:null,address:"Old street",comment:null,passportNumber:null,passportIssuedBy:null,projects:["do not send"]};
 await submitClientEditor(input,initial,actions);assert.deepEqual(captured,{name:"Old",phone:"200",lastName:null,middleName:null,email:null,address:"Old street",comment:null,passportNumber:null,passportIssuedBy:null});assert.equal(updated,1);
});

// Источник: product-preparation-status.test.ts
const preparation='PREPARATION' as ProductStatus;
test('preparation follows draft with label and neutral style',()=>{
 assert.equal(PRODUCT_STATUSES[0].id,'DRAFT');assert.equal(PRODUCT_STATUSES[1].id,preparation);assert.equal(PRODUCT_STATUSES[2].id,'DESIGN');
 assert.equal(productStatusLabels[preparation],'Подготовка');assert.ok(productStatusStyles[preparation]);
});

test('preparation denies product, project, tasks, execution, work and files for assigned field and engineering roles',()=>{
 for(const role of ['ENGINEER','WORKER','MOUNTER'] as Role[]){
 const actor={id:'assigned',roles:[role],engineeringParticipantProductIds:['p'],engineeringParticipantTaskIds:['t'],fieldParticipantProductIds:['p']};
 const product={id:'p',status:preparation,deletedAt:null,engineerId:'assigned',assemblerId:'assigned',assembler:{active:true,roles:['WORKER']},mounterId:'assigned',tasks:[{assigneeId:'assigned'}],project:{tasks:[{assigneeId:'assigned',productId:null}]}};
 const project={id:'project',deletedAt:null,products:[product],tasks:[{assigneeId:'assigned',productId:null}]};
 const task={id:'t',deletedAt:null,productId:'p',projectId:'project',assigneeId:'assigned',product,project};
 const file={deletedAt:null,productId:'p',taskId:null,product,project,task};
 const work={deletedAt:null,productId:'p',product,project,tasks:[task],paymentKind:'LEGACY',stagePayPoolId:null,poolWeightUnits:null};
 for(const [row,where] of [[product,productVisibilityWhere(actor)],[product,productEditWhere(actor)],[project,projectVisibilityWhere(actor)],[task,taskVisibilityWhere(actor)],[task,taskExecutionWhere(actor)],[file,fileVisibilityWhere(actor)],[work,workVisibilityWhere(actor)]])assert.equal(matches(row as FixtureRow,where as FixtureRow),false,`${role} ${JSON.stringify(where)}`);
 }
});

test('management can start preparation, engineering cannot and early transitions never accrue',()=>{
 const context={from:preparation,to:'DESIGN' as ProductStatus,assignedEngineer:true,participant:false,hasB3d:false,noModel:false};
 for(const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['MANAGER','ENGINEER']] as Role[][])assert.equal(decideProductPercentageStatus(roles,context).allowed,true);
 for(const role of ['ENGINEER','WORKER','MOUNTER'] as Role[])assert.equal(decideProductPercentageStatus([role],context).allowed,false);
 assert.deepEqual(percentageCompletionKinds(preparation,'DESIGN',true),[]);
 assert.deepEqual(percentageCompletionKinds('DESIGN',preparation,true),[]);
 assert.deepEqual(percentageCompletionKinds(preparation,'PRODUCTION',true),['ENGINEERING']);
});

test('field visibility of existing subsequent statuses follows the role matrix',()=>{
 for(const status of ['PRODUCTION','STORAGE','INSTALLATION','DONE','RECLAMATION'] as ProductStatus[]){
 for(const role of ['WORKER','MOUNTER'] as Role[]){
 const actor={id:'worker',roles:[role]};
 const allowed=role==='WORKER'?status==='PRODUCTION'||status==='STORAGE':status==='INSTALLATION';
 assert.equal(matches({deletedAt:null,status,tasks:[],project:{tasks:[]}},productVisibilityWhere(actor) as FixtureRow),allowed,`${role} ${status}`);
 }
 }
});

// Источник: product-status-barrier.test.ts
test("engineer status barrier never flushes clean readonly price/qty/assignment but runs every registered guard",async()=>{
 let posts=0,guards=0;const clean=["100.00",3,"engineer"].map(baseline=>({getSnapshot:()=>({baseline,draft:String(baseline),status:"idle"}),flush:async()=>{posts++;return false;}} as InlineSaveController));
 assert.equal(await flushProductStatusBarrier(clean,[async()=>{guards++;return true;},async()=>{guards++;return true;}]),true);assert.equal(posts,0);assert.equal(guards,2);
});
test("dirty technical draft is awaited and errors/conflicts block status",async()=>{
 let resolve!:(value:{kind:"saved";value:string})=>void;let posts=0,guard=0;
 const controller=createInlineSaveController<InlineValue>({initialValue:"old",format:String,parse:String,save:async()=>{posts++;return new Promise<{kind:"saved";value:string}>(done=>{resolve=done;});}});
 controller.setDraft("technical change");let settled=false;const barrier=flushProductStatusBarrier([controller],[async()=>{guard++;return true;}]).then(value=>{settled=true;return value;});
 await Promise.resolve();assert.equal(settled,false);assert.equal(posts,1);resolve({kind:"saved",value:"technical change"});assert.equal(await barrier,true);assert.equal(guard,1);
 for(const status of ["error","conflict","saving","dirty"] as const){const failed={getSnapshot:()=>({baseline:"same",draft:"same",status}),flush:async()=>false} as InlineSaveController;assert.equal(await flushProductStatusBarrier([failed],[]),false);}
 assert.equal(await flushProductStatusBarrier([],[async()=>false]),false);
});

// Источник: product-status-percentage-barrier.test.ts
test("readonly clean percentage guard never posts even noncanonical Decimal baseline while technical draft is awaited",async()=>{
 let patchCalls=0;const group=createSinglePercentageControllers({productId:"p",kind:"ENGINEERING",revision:1,initial:{ratePercent:"5",assigneeId:"engineer"},save:async()=>{patchCalls++;return{ok:false,kind:"forbidden",error:"No management write permission"};}});
 let release!:(value:{kind:"saved";value:string})=>void;const technical=createInlineSaveController<InlineValue>({initialValue:"before",format:String,parse:String,save:async()=>new Promise(done=>{release=done;})});
 technical.setDraft("after");let settled=false;const wait=flushProductStatusBarrier([technical],[()=>group.flush()]).then(result=>{settled=true;return result;});await Promise.resolve();assert.equal(settled,false);release({kind:"saved",value:"after"});assert.equal(await wait,true);assert.equal(patchCalls,0);assert.equal(group.controllers.ratePercent.getSnapshot().status,"idle");
});
test("dirty percentage permission failure continues to block status without a save permission bypass",async()=>{
 let patchCalls=0;const group=createSinglePercentageControllers({productId:"p",kind:"ENGINEERING",revision:1,initial:{ratePercent:"5",assigneeId:"engineer"},save:async()=>{patchCalls++;return{ok:false,kind:"forbidden",error:"No management write permission"};}});
 group.controllers.ratePercent.setDraft("6");assert.equal(await group.flush(),false);assert.equal(patchCalls,1);assert.equal(group.controllers.ratePercent.getSnapshot().status,"error");
});

// Источник: engineer-production-return.test.ts
const context={from:"DESIGN" as ProductStatus,to:"PRODUCTION" as ProductStatus,assignedEngineer:true,participant:false,hasB3d:false,noModel:false};
test("current engineer card/kanban allows both directions without a model; snapshots never substitute assignment",()=>{
 assert.equal(decideProductPercentageStatus(["ENGINEER"],context).allowed,true);
 assert.deepEqual(productStatusTargets(["ENGINEER"],{...context,from:"PRODUCTION"}),["DESIGN"]);
 assert.equal(decideProductPercentageStatus(["ENGINEER"],{...context,assignedEngineer:false,participant:true}).allowed,false);
 for(const to of ["STORAGE","INSTALLATION","DONE","RECLAMATION"] as ProductStatus[])assert.equal(decideProductPercentageStatus(["ENGINEER"],{...context,to}).allowed,false);
 for(const roles of [["MANAGER"],["ADMIN"],["DIRECTOR"],["ENGINEER","MANAGER"]] as Role[][])for(const to of ["DESIGN","PRODUCTION","STORAGE","INSTALLATION","DONE","RECLAMATION"] as ProductStatus[])assert.equal(decideProductPercentageStatus(roles,{...context,assignedEngineer:false,to}).allowed,true);
});
test("assigned production read does not expand technical edit or legacy participant visibility",()=>{
 const actor={id:"e",roles:["ENGINEER" as Role],engineeringParticipantProductIds:["old"]};
 const row={id:"p",deletedAt:null,project:{deletedAt:null},engineerId:"e",status:"PRODUCTION"};
 assert.equal(matches(row,productVisibilityWhere(actor) as FixtureRow),true);
 assert.equal(matches(row,productEditWhere(actor) as FixtureRow),false);
 assert.equal(matches({id:"old",engineerId:"foreign",status:"DESIGN"},productVisibilityWhere(actor) as FixtureRow),false);
});
test("server return/production repeat preserves paid completion without files or tasks",async()=>{
 const product={id:"p",projectId:"project",title:"Изделие",engineerId:"e",status:"PRODUCTION" as ProductStatus,files:[],percentageConfigs:[]};let payroll=0,history=0;
 const tx={$queryRaw:async()=>[],product:{findUnique:async()=>({...product}),update:async({data}:{data:{status:ProductStatus}})=>{product.status=data.status;return {...product};}},task:{findFirst:async()=>null},productPercentageCompletion:{findUnique:async()=>({state:"SETTLED"})},productStatusHistory:{create:async()=>{history++;return{};}},changeLog:{create:async()=>({})},domainEvent:{create:async()=>({id:"event"})},payrollEntry:{create:async()=>{payroll++;throw Error("must not pay twice")}}} as unknown as Prisma.TransactionClient;
 const actor={id:"e",roles:["ENGINEER" as Role],source:"web" as const,name:"Инженер"};
 assert.equal((await changeProductStatusTransaction(tx,actor,"p","DESIGN")).ok,true);
 assert.equal((await changeProductStatusTransaction(tx,actor,"p","PRODUCTION")).ok,true);
 assert.equal((await changeProductStatusTransaction(tx,actor,"p","PRODUCTION")).ok,true);
 assert.equal(history,2);assert.equal(payroll,0);
 assert.equal((await changeProductStatusTransaction(tx,{...actor,id:"old"},"p","DESIGN")).ok,false);
});
test("retired ordinary NoModel setter cannot read or mutate historical data", async () => {
 const tx = new Proxy({}, {get(){throw Error("Retired setter must not access database");}}) as Prisma.TransactionClient;
 await assert.rejects(setProductNoModelCore({id:"manager",name:"Менеджер",roles:["MANAGER"],source:"web"},"p",true,tx), /больше не используется/);
});
