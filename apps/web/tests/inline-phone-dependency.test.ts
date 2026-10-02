import test from "node:test";
import assert from "node:assert/strict";
import { createInlineSaveController } from "../src/lib/inline-save-controller";
import { resolvePhoneDependency } from "../src/lib/inline-phone-dependency";
test("phone waits for local client save and conflicts instead of writing to old client",async()=>{
 let release!:(reply:{kind:"saved";value:string})=>void;let current={id:"A",phone:"100",label:"Client A"};
 const client=createInlineSaveController({initialValue:"A",format:(v:string)=>v,parse:v=>v,save:async()=>{const result=await new Promise<{kind:"saved";value:string}>(done=>{release=done;});current={id:"B",phone:"999",label:"Client B"};return result;}});
 client.setDraft("B");void client.commit();let resolved=false;const waiting=resolvePhoneDependency(client,"A",()=>current).then(result=>{resolved=true;return result;});await Promise.resolve();assert.equal(resolved,false);
 release({kind:"saved",value:"B"});const result=await waiting;assert.equal(result.kind,"conflict");if(result.kind==="conflict"){assert.equal(result.currentValue,"999");assert.equal(result.currentClientId,"B");}
});
test("failed client save blocks dependent phone without losing its expected target",async()=>{
 const client=createInlineSaveController({initialValue:"A",format:(v:string)=>v,parse:v=>v,save:async()=>({kind:"conflict" as const,error:"Client changed",currentValue:"C"})});client.setDraft("B");await client.commit();const result=await resolvePhoneDependency(client,"A",()=>({id:"A",phone:"100"}));assert.equal(result.kind,"blocked");
});
test("confirmed same client keeps its exact binding for normal phone CAS",async()=>{
 const client=createInlineSaveController({initialValue:"A",format:(v:string)=>v,parse:v=>v,save:async()=>({kind:"saved" as const,value:"A"})});const result=await resolvePhoneDependency(client,"A",()=>({id:"A",phone:"100"}));assert.deepEqual(result,{kind:"ready",expectedClientId:"A"});
});
