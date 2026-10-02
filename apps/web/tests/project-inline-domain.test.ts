import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {Prisma} from "@prisma/client";
import type {TaskTransaction} from "../src/server/tasks/transaction";
import {patchProjectCore} from "../src/server/projects/project-field-core";
import {projectPatchSchema,type ProjectPatch} from "../src/server/projects/patch-contract";
const actor={id:"m",name:"Manager",roles:["MANAGER" as const],source:"web" as const};
function fixture(){
 let project={id:"j",title:"Old",clientId:"c",managerId:null as string|null,address:null as string|null,currency:"BYN",delivery:null as string|null,unloading:"0.00" as string|null,installation:"10.00" as string|null,initialPrice:"200.00"};
 const logs:Record<string,unknown>[]=[];const events:unknown[]=[];const reads:string[]=[];let fail=false;let failEvent=false;
 let pricingVersion=0;let products: {expectedPrice:string|null;quantity:number}[]=[{expectedPrice:"100.00",quantity:3}];
 const tx={$queryRaw:async(strings:TemplateStringsArray)=>strings.join("").includes("txid_current")?[{pricingVersion:String(++pricingVersion)}]:[],project:{findUnique:async()=>({...project}),update:async({data}:{data:object})=>Object.assign(project,data),updateMany:async({data}:{data:object})=>{Object.assign(project,data);return{count:1};}},
  product:{findMany:async()=>{reads.push("product-prices");return products;}},
  user:{findFirst:async()=>({id:"manager",name:"Manager",roles:["MANAGER"],active:true})},
  changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{if(fail)throw Error("audit failure");logs.push(data);return data;}},
  domainEvent:{create:async({data}:{data:unknown})=>{if(failEvent)throw Error("outbox failure");events.push(data);return{id:"event"};}},
 }as unknown as Prisma.TransactionClient;
 let tail=Promise.resolve();const transaction:TaskTransaction=async fn=>{const previous=tail;let release!:()=>void;tail=new Promise(r=>{release=r;});await previous;const before={...project};const n=logs.length,e=events.length;try{return await fn(tx);}catch(error){project=before;logs.length=n;events.length=e;throw error;}finally{release();}};
 return{transaction,project:()=>project,logs,events,reads,fail:()=>{fail=true;},failEvent:()=>{failEvent=true;},setProducts:(rows:typeof products)=>{products=rows;}};
}
const patch=(extra:Partial<ProjectPatch>={}):ProjectPatch=>({projectId:"j",field:"title",value:"New",expectedValue:"Old",clientMutationId:randomUUID(),...extra}as ProjectPatch);
test("closed project DTO rejects unknown fields/money and required phone, keeps zero/null",()=>{
 assert.equal(projectPatchSchema.safeParse({...patch(),field:"initialPrice"}).success,false);assert.equal(projectPatchSchema.safeParse(patch({field:"delivery",value:"-1",expectedValue:null})).success,false);
 assert.equal(projectPatchSchema.safeParse(patch({field:"delivery",value:"0",expectedValue:null})).success,true);
});
test("same-field CAS race and different field writes do not overwrite neighbors",async()=>{
 const f=fixture();const r=await Promise.all([patchProjectCore(actor,patch(),f.transaction),patchProjectCore(actor,patch({value:"Other"}),f.transaction)]);assert.deepEqual(r.map(x=>x.kind).sort(),["conflict","saved"]);assert.equal(f.project().title,"New");
 assert.equal((await patchProjectCore(actor,patch({field:"managerId",value:"manager",expectedValue:null}),f.transaction)).kind,"saved");assert.equal(f.project().title,"New");
});
test("no-op and UUID replay avoid duplicate audit; changed payload is rejected",async()=>{
 const f=fixture();assert.equal((await patchProjectCore(actor,patch({value:"Old"}),f.transaction)).kind,"saved");assert.equal(f.logs.length,0);
 const input=patch();assert.equal((await patchProjectCore(actor,input,f.transaction)).kind,"saved");const count=f.logs.length;
 assert.equal((await patchProjectCore(actor,input,f.transaction)).kind,"saved");assert.equal(f.logs.length,count);
 assert.equal((await patchProjectCore(actor,{...input,value:"Other"}as ProjectPatch,f.transaction)).kind,"validation");
});
test("service zero/null and exact expected total require only minimal product price read",async()=>{
 const f=fixture();const result=await patchProjectCore(actor,patch({field:"delivery",value:"0",expectedValue:null}),f.transaction);assert.equal(result.kind,"saved");if(result.kind==="saved")assert.equal(result.derived?.expectedTotalBYN,"310.00");assert.equal(f.project().delivery,"0.00");assert.deepEqual(f.reads,["product-prices"]);
 const title=await patchProjectCore(actor,patch(),f.transaction);assert.equal(title.kind,"saved");assert.equal(f.reads.length,1);
});
test("audit failure rolls back and readonly roles cannot disclose conflict values",async()=>{
 const f=fixture();f.fail();assert.equal((await patchProjectCore(actor,patch(),f.transaction)).kind,"failure");assert.equal(f.project().title,"Old");
 const result=await patchProjectCore({...actor,roles:["ACCOUNTANT"]as never},patch(),f.transaction);assert.equal(result.kind,"forbidden");assert.equal('currentValue'in result,false);
});

test("legacy title/manager/services require real baseline; untouched stale fields are omitted",async()=>{
 const {updateProjectFieldsCore}=await import("../src/server/projects/project-field-core");
 const f=fixture();
 assert.equal((await updateProjectFieldsCore(actor,"j",{title:"Unsafe"},f.transaction)).ok,false);assert.equal(f.project().title,"Old");
 f.project().managerId="other-manager";f.project().delivery="20.00";
 const result=await updateProjectFieldsCore(actor,"j",{title:"New",managerId:null,delivery:null,baseline:{title:"Old",managerId:null,delivery:null}},f.transaction);
 assert.equal(result.ok,true);assert.equal(f.project().title,"New");assert.equal(f.project().managerId,"other-manager");assert.equal(f.project().delivery,"20.00");
});
test("legacy stale service and initialPrice cannot bypass CAS or write unrelated fields",async()=>{
 const {updateProjectFieldsCore}=await import("../src/server/projects/project-field-core");const f=fixture();
 f.project().delivery="20.00";
 const service=await updateProjectFieldsCore(actor,"j",{title:"Lost",delivery:"30.00",baseline:{title:"Old",delivery:null}},f.transaction);
 assert.equal(service.ok,false);assert.equal(f.project().title,"Old");
 const snapshot=await updateProjectFieldsCore(actor,"j",{initialPrice:300,baseline:{initialPrice:"100.00"}} as never,f.transaction);
 assert.equal(snapshot.ok,false);assert.equal(f.project().initialPrice,"200.00");
});
test("malformed envelope/readonly request performs no data or receipt lookup",async()=>{
 let calls=0;const transaction:TaskTransaction=async()=>{calls++;throw Error("unexpected DB");};
 for(const value of [null,undefined,42,"bad",[],{}])assert.equal((await patchProjectCore(actor,value as ProjectPatch,transaction)).kind,"validation");
 const result=await patchProjectCore({...actor,roles:["ENGINEER"]as never},patch(),transaction);assert.equal(result.kind,"forbidden");assert.equal(calls,0);
});

test("outbox failure rolls back scalar change and leaves receipt absent",async()=>{
 const f=fixture();f.failEvent();const result=await patchProjectCore(actor,patch(),f.transaction);
 assert.equal(result.kind,"failure");assert.equal(f.project().title,"Old");assert.equal(f.logs.length,0);assert.equal(f.events.length,0);
});
test("manager union remains writable and service null is distinct from confirmed zero",async()=>{
 const f=fixture();const first=await patchProjectCore({...actor,roles:["MANAGER","ENGINEER"]},patch({field:"unloading",value:null,expectedValue:"0.00"}),f.transaction);
 assert.equal(first.kind,"saved");assert.equal(f.project().unloading,null);
});

test("unknown product price stays unknown after a valid service write; zero and no products stay known",async()=>{
 for(const [products,subtotal,total] of [
  [[{expectedPrice:null,quantity:3}],null,null],
  [[{expectedPrice:"0.00",quantity:3}],"0.00","10.00"],
  [[],"0.00","10.00"],
 ] as const){
  const f=fixture();f.setProducts([...products]);const result=await patchProjectCore(actor,patch({field:"delivery",value:"0",expectedValue:null}),f.transaction);
  assert.equal(result.kind,"saved");assert.equal(f.project().delivery,"0.00");if(result.kind==="saved"){assert.equal(result.derived?.expectedTotalBYN,total);assert.equal(result.derived?.productsSubtotalBYN,subtotal);}
 }
});
test("service pricing projection versions and product subtotal advance without rewriting field baselines",async()=>{
 const f=fixture();const one=await patchProjectCore(actor,patch({field:"delivery",value:"1",expectedValue:null}),f.transaction);
 f.setProducts([{expectedPrice:"200.00",quantity:3}]);
 const two=await patchProjectCore(actor,patch({field:"unloading",value:"2",expectedValue:"0.00"}),f.transaction);
 assert.equal(one.kind,"saved");assert.equal(two.kind,"saved");if(one.kind==="saved"&&two.kind==="saved"){
  assert.equal(one.derived?.productsSubtotalBYN,"300.00");assert.equal(two.derived?.productsSubtotalBYN,"600.00");
  assert.ok(BigInt(two.derived!.pricingVersion!)>BigInt(one.derived!.pricingVersion!));assert.equal(two.derived?.delivery,"1.00");assert.equal(two.derived?.unloading,"2.00");
 }
});


test("new initial/RSC pricing read has newer version than earlier ACK and hides full pricing from limited roles",async()=>{
 const {getProjectPricingProjection}=await import("../src/server/projects/project-field-core");const f=fixture();
 const old=await patchProjectCore(actor,patch({field:"delivery",value:"1",expectedValue:null}),f.transaction);
 f.setProducts([{expectedPrice:"200.00",quantity:3}]);
 const fresh=await getProjectPricingProjection(actor,"j",f.transaction);
 assert.equal(old.kind,"saved");assert.equal(fresh?.productsSubtotalBYN,"600.00");if(old.kind==="saved")assert.ok(BigInt(fresh!.pricingVersion)>BigInt(old.derived!.pricingVersion!));
 let accessed=false;const denied=await getProjectPricingProjection({...actor,roles:["ENGINEER"]as never},"j",async()=>{accessed=true;throw Error("hidden DB");});assert.equal(denied,null);assert.equal(accessed,false);
});

test("stored receipt is reusable only with matching entity/action/field metadata",async()=>{
 const f=fixture();const input=patch();assert.equal((await patchProjectCore(actor,input,f.transaction)).kind,"saved");
 const record=f.logs[0];record.action="update";const result=await patchProjectCore(actor,input,f.transaction);assert.equal(result.kind,"validation");assert.equal(f.logs.length,1);assert.equal(f.project().title,"New");
});

test("legacy non-BYN initial projection does not relabel raw prices/services and reads no subtotal",async()=>{
 const {getProjectPricingProjection}=await import("../src/server/projects/project-field-core");const f=fixture();f.project().currency="USD";
 assert.equal(await getProjectPricingProjection(actor,"j",f.transaction),null);assert.deepEqual(f.reads,[]);
});
