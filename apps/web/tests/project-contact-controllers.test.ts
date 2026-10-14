import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectContactControllers } from "../src/lib/project-contact-controllers";
import { type ProjectPatch, type ProjectPatchResult } from "../src/server/projects/patch-contract";
import { createInlineSaveController, type InlineRequest, type InlineReply } from "../src/lib/inline-save-controller";
import { type PrismaClient } from "@prisma/client";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";
import { initialProductPercentageParticipants } from "../src/lib/product-percentage-ui";
import { parseProjectInlineValue, confirmedProjectTotal, projectSubtotalFromProjection } from "../src/lib/project-inline-values";
import { createProjectPricingCache } from "../src/lib/project-pricing-cache";

// Источник: project-contact-controllers.test.ts
const initial={clientId:'a','client.phone':'100','client.address':'Client A'};
function saved(input:ProjectPatch):ProjectPatchResult{return{kind:'saved',field:input.field,value:input.value,clientMutationId:input.clientMutationId,...(input.field==='clientId'?{derived:{clientId:String(input.value),phone:'200',clientAddress:'Client B'}}:{})};}
test('client switch waits for delayed contact ACK and binds only canonical new contacts',async()=>{
 const calls:ProjectPatch[]=[];let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 const group=createProjectContactControllers('project',initial,async input=>{calls.push(input);if(input.field==='client.phone')await wait;return saved(input);});
 const phone=group.controller('client.phone');phone.setDraft('300');const saving=phone.commit();
 const client=group.controller('clientId');client.setDraft('b');const switching=client.commit();
 assert.equal(group.getSnapshot().switching,true);assert.deepEqual(calls.map(row=>row.field),['client.phone']);assert.equal(group.getSnapshot().clientId,'a');
 release();assert.equal(await saving,true);assert.equal(await switching,true);
 assert.deepEqual(calls.map(row=>row.field),['client.phone','clientId']);assert.equal('expectedClientId' in calls[0]&&calls[0].expectedClientId,'a');
 assert.equal(group.getSnapshot().clientId,'b');assert.equal(group.controller('client.phone').getSnapshot().baseline,'200');assert.equal(group.controller('client.address').getSnapshot().baseline,'Client B');
});
test('failed contact flush preserves input and blocks selection request',async()=>{
 const calls:ProjectPatch[]=[];const group=createProjectContactControllers('project',initial,async input=>{calls.push(input);return{kind:'failure',field:input.field,clientMutationId:input.clientMutationId,error:'Rejected'};});
 group.controller('client.address').setDraft('My draft');group.controller('clientId').setDraft('b');assert.equal(await group.controller('clientId').commit(),false);
 assert.deepEqual(calls.map(row=>row.field),['client.address']);assert.equal(group.getSnapshot().clientId,'a');assert.equal(group.controller('client.address').getSnapshot().draft,'My draft');
});
test('server refresh cannot bind old drafts to another client or erase pending input',async()=>{
 const group=createProjectContactControllers('project',initial,async input=>saved(input));
 group.controller('client.phone').setDraft('My draft');assert.equal(group.receive({clientId:'b','client.phone':'200','client.address':'B'}),false);
 assert.equal(group.getSnapshot().clientId,'a');assert.equal(group.controller('clientId').getSnapshot().baseline,'a');assert.equal(group.controller('client.phone').getSnapshot().draft,'My draft');
});
test('binding conflict cannot rebase a contact onto a different client',async()=>{
 const group=createProjectContactControllers('project',initial,async input=>({kind:'conflict',field:input.field,clientMutationId:input.clientMutationId,error:'Changed',currentValue:'200',currentClientId:'b'}));
 const phone=group.controller('client.phone');phone.setDraft('My draft');assert.equal(await phone.commit(),false);assert.equal(phone.getSnapshot().currentValue,undefined);
 assert.equal(await phone.rebaseAndRetry(),false);assert.equal(phone.getSnapshot().draft,'My draft');assert.equal(group.getSnapshot().clientId,'a');
});
test('clean server renders replace canonical contacts and unchanged legacy empty phone permits selection',async()=>{
 const group=createProjectContactControllers('project',{...initial,'client.phone':''},async input=>saved(input));
 group.controller('clientId').setDraft('b');assert.equal(await group.controller('clientId').commit(),true);
 assert.equal(group.receive({clientId:'b','client.phone':'New phone','client.address':null}),true);
 assert.equal(group.controller('client.phone').getSnapshot().baseline,'New phone');assert.equal(group.controller('client.address').getSnapshot().baseline,null);
});

// Источник: inline-save-controller.test.ts
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve}; }
function setup() {
 const calls:InlineRequest<string|null>[]=[];const replies:ReturnType<typeof deferred<InlineReply<string|null>>>[]=[];let n=0;
 const controller=createInlineSaveController<string|null>({initialValue:"old",format:value=>value??"",parse:value=>value.trim()||null,id:()=>`mutation-${++n}`,save:request=>{calls.push(request);const reply=deferred<InlineReply<string|null>>();replies.push(reply);return reply.promise;}});
 return {controller,calls,replies};
}
test("Enter plus blur deduplicates the same inflight field",async()=>{const s=setup();s.controller.setDraft("new");const first=s.controller.commit();const blur=s.controller.commit();assert.equal(s.calls.length,1);s.replies[0].resolve({kind:"saved",value:"new"});assert.equal(await first,true);assert.equal(await blur,true);});
test("slow response retains new draft, queues latest with acknowledged baseline",async()=>{const s=setup();s.controller.setDraft("one");const pending=s.controller.commit();s.controller.setDraft("two");s.controller.setDraft("three");void s.controller.commit();assert.equal(s.controller.getSnapshot().draft,"three");s.replies[0].resolve({kind:"saved",value:"one"});await Promise.resolve();await Promise.resolve();assert.equal(s.controller.getSnapshot().draft,"three");assert.equal(s.calls.length,2);assert.equal(s.calls[1].expectedValue,"one");assert.equal(s.calls[1].value,"three");s.replies[1].resolve({kind:"saved",value:"three"});await pending;assert.equal(s.controller.getSnapshot().baseline,"three");});
test("unchanged value does not send even on repeated flush",async()=>{const s=setup();assert.equal(await s.controller.flush(),true);assert.equal(await s.controller.commit(),true);assert.equal(s.calls.length,0);});
test("network uncertainty retries identical mutation ID before queued edit",async()=>{let n=0;const calls:InlineRequest<string|null>[]=[];let fail=true;const controller=createInlineSaveController<string|null>({initialValue:"old",format:v=>v??"",parse:v=>v,id:()=>`id-${++n}`,save:async request=>{calls.push(request);if(fail)throw new Error("lost response");return {kind:"saved",value:request.value};}});controller.setDraft("one");assert.equal(await controller.commit(),false);controller.setDraft("two");fail=false;assert.equal(await controller.retry(),true);assert.equal(calls.length,3);assert.deepEqual(calls[1],calls[0]);assert.equal(calls[2].expectedValue,"one");assert.equal(controller.getSnapshot().draft,"two");});
test("conflict keeps input and blocks flush until explicit rebase",async()=>{const s=setup();s.controller.setDraft("mine");const pending=s.controller.commit();s.replies[0].resolve({kind:"conflict",error:"Changed elsewhere",currentValue:"theirs"});assert.equal(await pending,false);assert.equal(s.controller.getSnapshot().draft,"mine");assert.equal(await s.controller.flush(),false);const retried=s.controller.rebaseAndRetry();assert.equal(s.calls[1].expectedValue,"theirs");s.replies[1].resolve({kind:"saved",value:"mine"});assert.equal(await retried,true);});
test("invalid input never sends; zero and optional null stay distinct",async()=>{const values:(number|null)[]=[];const c=createInlineSaveController<number|null>({initialValue:null,format:v=>v===null?"":String(v),parse:raw=>{if(raw==="")return null;const value=Number(raw);if(!Number.isInteger(value)||value<0)throw Error("Invalid");return value;},save:async r=>{values.push(r.value);return{kind:"saved",value:r.value};}});c.setDraft("bad");assert.equal(await c.flush(),false);c.setDraft("0");assert.equal(await c.flush(),true);c.setDraft("");assert.equal(await c.flush(),true);assert.deepEqual(values,[0,null]);});
test("flush drains latest draft and errors stop dependent status",async()=>{const s=setup();s.controller.setDraft("one");const flushing=s.controller.flush();assert.equal(s.calls.length,1);s.controller.setDraft("two");s.replies[0].resolve({kind:"saved",value:"one"});await Promise.resolve();await Promise.resolve();s.replies[1].resolve({kind:"validation",error:"Cannot save"});assert.equal(await flushing,false);assert.equal(s.controller.getSnapshot().draft,"two");assert.equal(s.controller.getSnapshot().status,"error");});
test("external server refresh cannot erase an unsaved neighboring draft",()=>{const s=setup();s.controller.setDraft("mine");s.controller.receive("updated elsewhere");assert.equal(s.controller.getSnapshot().draft,"mine");assert.equal(s.controller.getSnapshot().baseline,"old");});

test("typing is local until explicit commit; neighboring fields stay independent",async()=>{const a=setup();const b=setup();a.controller.setDraft("draft a");b.controller.setDraft("draft b");assert.equal(a.calls.length,0);assert.equal(b.calls.length,0);const first=a.controller.commit();const second=b.controller.commit();assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);b.replies[0].resolve({kind:"saved",value:"draft b"});await second;assert.equal(a.controller.getSnapshot().status,"saving");a.replies[0].resolve({kind:"saved",value:"draft a"});await first;});
test("changed client conflict shows target and only explicit rebase retargets phone",async()=>{let target="client-old";const snapshots:{target:string;request:InlineRequest<string>}[]=[];let attempt=0;const c=createInlineSaveController<string>({initialValue:"111",format:v=>v,parse:v=>v,onRebase:s=>{target=s.currentClientId!;},save:async request=>{snapshots.push({target,request});return ++attempt===1?{kind:"conflict",error:"Client changed",currentValue:"222",currentClientId:"client-new",currentClientLabel:"New client"}:{kind:"saved",value:request.value};}});c.setDraft("333");assert.equal(await c.commit(),false);assert.equal(target,"client-old");assert.equal(c.getSnapshot().draft,"333");assert.equal(c.getSnapshot().currentClientLabel,"New client");assert.equal(await c.flush(),false);assert.equal(await c.rebaseAndRetry(),true);assert.equal(snapshots[1].target,"client-new");assert.equal(snapshots[1].request.expectedValue,"222");assert.equal(snapshots[1].request.value,"333");});

test("typing a newer draft during slow save does not surprise-write until another trigger",async()=>{const s=setup();s.controller.setDraft("one");const first=s.controller.commit();s.controller.setDraft("partially typed next value");s.replies[0].resolve({kind:"saved",value:"one"});await first;assert.equal(s.calls.length,1);assert.equal(s.controller.getSnapshot().draft,"partially typed next value");assert.equal(s.controller.getSnapshot().status,"dirty");const blur=s.controller.commit();assert.equal(s.calls[1].expectedValue,"one");s.replies[1].resolve({kind:"saved",value:"partially typed next value"});await blur;});

test("late hydrating consumer receives immutable initial server snapshot after another client consumer edits and saves",async()=>{
 const s=setup();
 const compatible=s.controller as typeof s.controller & {getServerSnapshot?:typeof s.controller.getSnapshot};
 const readServer=compatible.getServerSnapshot??s.controller.getSnapshot;
 const initialSSR=readServer();
 s.controller.setDraft("already edited in hydrated consumer");const saving=s.controller.commit();
 assert.equal(s.controller.getSnapshot().status,"saving");
 assert.strictEqual(readServer(),initialSSR,"late hydration must reproduce the original SSR, not live client draft");
 s.replies[0].resolve({kind:"saved",value:"already edited in hydrated consumer"});await saving;
 assert.equal(s.controller.getSnapshot().baseline,"already edited in hydrated consumer");
 assert.strictEqual(readServer(),initialSSR);assert.equal(readServer().draft,"old");assert.equal(readServer().status,"idle");assert.ok(Object.isFrozen(readServer()));
 s.controller.receive("fresh ordinary client snapshot");assert.equal(s.controller.getSnapshot().draft,"fresh ordinary client snapshot");assert.strictEqual(readServer(),initialSSR);
});

// Источник: inline-engineer-fallback.test.ts
function database(configured=false) {
 return {task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]},user:{findMany:async()=>[{id:"new",name:"Новый"}]},product:{findFirst:async()=>({id:"p",projectId:"project",noModel:false,engineerId:"old",engineer:{name:"Старый"},expectedPrice:{toString:()=>"10.01"},project:{currency:"BYN"},files:[],works:[],stagePayPools:[],percentageCompletions:[],percentageConfigs:configured?[{kind:"ENGINEERING",revision:0,ratePercent:null,participants:[{userId:"old",shareUnits:1000000,user:{name:"Старый"}}]}]:[]})}} as unknown as Pick<PrismaClient,"product"|"task"|"productPercentageParticipant"|"user"|"payrollEntry">;
}
test("query explicitly distinguishes fallback member from real configuration even when revision0",async()=>{
 const fallback=(await getProductPercentageView({id:"admin",roles:["ADMIN"]},"p",database())).sections.ENGINEERING;
 assert.equal(fallback.members.length,1);
 assert.equal(fallback.hasConfiguration,false);
 const configured=(await getProductPercentageView({id:"admin",roles:["ADMIN"]},"p",database(true))).sections.ENGINEERING;
 assert.equal(configured.hasConfiguration,true);assert.equal(configured.revision,0);
});
test("real query fallback follows new acknowledged engineer while configured/frozen members stay",async()=>{
 const fallback=(await getProductPercentageView({id:"admin",roles:["ADMIN"]},"p",database())).sections.ENGINEERING;
 const suggested={...fallback,hasConfiguration:false};
 const previous=initialProductPercentageParticipants("ENGINEERING",suggested,"old");
 const next=initialProductPercentageParticipants("ENGINEERING",suggested,"new");
 assert.deepEqual(next,[{userId:"new",shareUnits:1000000}]);
 const configured={...suggested,hasConfiguration:true};assert.deepEqual(initialProductPercentageParticipants("ENGINEERING",configured,"new"),previous);
 const frozen={...suggested,state:"SETTLED" as const};assert.deepEqual(initialProductPercentageParticipants("ENGINEERING",frozen,"new"),previous);
});

// Источник: project-inline-values.test.ts
test("project services are decimal strings; null and zero are distinct, invalid fraction never accepted",()=>{assert.equal(parseProjectInlineValue("delivery","0"),"0.00");assert.equal(parseProjectInlineValue("delivery",""),null);assert.equal(parseProjectInlineValue("unloading","0,10"),"0.10");assert.throws(()=>parseProjectInlineValue("installation","1.001"));assert.throws(()=>parseProjectInlineValue("client.phone","  "));});
test("late service ACK cannot overwrite newer peer service in displayed confirmed total",()=>{const lateSubtotal=projectSubtotalFromProjection("10.11",["0.10",null,null]);assert.equal(lateSubtotal,"10.01");assert.equal(confirmedProjectTotal(lateSubtotal,["0.10","0.20",null]),"10.31");assert.equal(confirmedProjectTotal(null,["0.00",null,null]),null);assert.equal(confirmedProjectTotal("0.00",["0.00",null,null]),"0.00");});

// Источник: project-pricing-cache.test.ts
const projection=(version:string,subtotal:string|null)=>({pricingVersion:version,productsSubtotalBYN:subtotal,expectedTotalBYN:subtotal,delivery:null,unloading:null,installation:null});
test("held older service ACK cannot roll product subtotal back across newer ACK or RSC snapshot",()=>{const cache=createProjectPricingCache(projection("100","20.02"));assert.equal(cache.apply(projection("102","30.03")).kind,"accepted");assert.equal(cache.apply(projection("101","20.02")).kind,"stale");assert.equal(cache.getSnapshot()?.productsSubtotalBYN,"30.03");assert.equal(cache.apply(projection("105","40.04")).kind,"accepted");assert.equal(cache.apply(projection("103","30.03")).kind,"stale");assert.equal(cache.getSnapshot()?.productsSubtotalBYN,"40.04");});
test("unknown product price stays null, valid zero stays zero, malformed version preserves confirmed snapshot",()=>{const cache=createProjectPricingCache(projection("1","0.00"));assert.equal(cache.apply(projection("2",null)).kind,"accepted");assert.equal(cache.getSnapshot()?.productsSubtotalBYN,null);const prior=cache.getSnapshot();assert.equal(cache.apply(projection("NaN","99.99")).kind,"invalid");assert.strictEqual(cache.getSnapshot(),prior);assert.equal(cache.apply({...projection("3","99.99"),delivery:undefined}).kind,"invalid");assert.strictEqual(cache.getSnapshot(),prior);});
