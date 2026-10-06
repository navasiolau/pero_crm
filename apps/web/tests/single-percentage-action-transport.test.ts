import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import type {ProductPercentagePatch} from "../src/server/product-percentage-pay/contracts";
const require=createRequire(import.meta.url);
type FixturePlugin={onResolve:(options:{filter:RegExp},callback:(args:{path:string})=>{path:string;namespace:string}|null)=>void;onLoad:(options:{filter:RegExp;namespace:string},callback:(args:{path:string})=>{contents:string;loader:"js"})=>void};
type BuildOptions={entryPoints:string[];absWorkingDir:string;bundle:boolean;write:boolean;format:"cjs";platform:"node";target:string;logLevel:"silent";plugins:{name:string;setup:(plugin:FixturePlugin)=>void}[]};
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild") as {build:(options:BuildOptions)=>Promise<{outputFiles:{text:string}[]}>};
async function actualActions(){
 const probe={cacheCalls:0,domainCalls:0,inputs:[] as ProductPercentagePatch[],patch:async(input:ProductPercentagePatch)=>{probe.domainCalls++;probe.inputs.push(input);return{ok:true,kind:"saved",field:input.field,value:input.value,revision:1,clientMutationId:input.clientMutationId,noOp:false,repeated:false}}};
 const stubs:Record<string,string>={
  "@/auth":'export async function auth(){return {user:{id:"manager",name:"Manager",roles:["MANAGER"]}}}',
  "@/server/products/revalidate":'export async function revalidateProductPaths(){globalThis.__pctActionProbe.cacheCalls++}',
  "@/server/notifications/notify":'export async function notifyPerson(){}',
  "@/server/tasks/transaction":'export async function withTaskTransaction(fn){return fn({fixture:"transaction"})}',
  "./patch-core":'export async function patchProductPercentageCore(_actor,input){return globalThis.__pctActionProbe.patch(input)}',
  "./core":'export async function configureProductPercentageCore(){return {ok:true}};export async function setProductNoModelCore(){return {ok:true}};export async function settlePendingProductPercentage(){return {state:"SETTLED"}};export async function transferProductPercentageCore(){return {ok:false}}',
 };
 const result=await build({entryPoints:[resolve("src/server/product-percentage-pay/actions.ts")],absWorkingDir:process.cwd(),bundle:true,write:false,format:"cjs",platform:"node",target:"node22",logLevel:"silent",plugins:[{name:"thin-action-fixtures",setup(plugin){plugin.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:"action-fixture"}:null);plugin.onLoad({filter:/.*/,namespace:"action-fixture"},args=>({contents:stubs[args.path],loader:"js"}));}}]});
 const moduleFixture={exports:{}};runInNewContext(result.outputFiles[0].text,{module:moduleFixture,exports:moduleFixture.exports,__pctActionProbe:probe},{timeout:1000});
 return{probe,actions:moduleFixture.exports as typeof import("../src/server/product-percentage-pay/actions")};
}
test("actual partial percentage Server Action returns compact domain ACK without cache revalidation",async()=>{
 const {actions,probe}=await actualActions();const input:ProductPercentagePatch={productId:"own-product",kind:"ASSEMBLY",field:"ratePercent",value:"0",expectedValue:null,expectedRevision:0,clientMutationId:"00000000-0000-4000-8000-000000000001"};
 const result=await actions.patchProductPercentageAction(input);
 assert.equal(result.kind,"saved");assert.equal(probe.domainCalls,1);assert.equal(probe.inputs[0],input);
 assert.equal(probe.cacheCalls,0,"partial fields must not cause a full card Flight refresh");
 assert.deepEqual(Object.keys(result).sort(),["ok","kind","field","value","revision","clientMutationId","noOp","repeated"].sort());
});
test("actual legacy frozen retry still revalidates through its existing action boundary",async()=>{
 const {actions,probe}=await actualActions();const result=await actions.retryProductPercentageAction({productId:"own-product",kind:"ASSEMBLY"});assert.equal(result.ok,true);assert.equal(probe.cacheCalls,1);assert.equal(probe.domainCalls,0);
});
