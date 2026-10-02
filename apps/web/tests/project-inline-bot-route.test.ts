import assert from "node:assert/strict";
import {before,beforeEach,test} from "node:test";
import {createRequire,Module} from "node:module";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
const require=createRequire(import.meta.url);let route:typeof import("../src/app/api/v1/bot/projects/[id]/route");
let project={id:"j",title:"Old",clientId:"c",managerId:null,address:null,currency:"BYN",delivery:null,unloading:null,installation:null,initialPrice:null};
const logs:Record<string,unknown>[]=[];const events:unknown[]=[];let databaseCalls=0;
const actor={id:"m",name:"Manager",roles:["MANAGER"],source:"telegram"};
const db={$queryRaw:async()=>{databaseCalls++;return[];},project:{findUnique:async()=>({...project}),update:async({data}:{data:object})=>Object.assign(project,data)},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}},domainEvent:{create:async({data}:{data:unknown})=>{events.push(data);return{id:"e"};}},$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn(db)};
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(()=>{
 (globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;
 inject("../src/server/api/auth",{authenticate:async()=>({}),isErrorResponse:()=>false});
 inject("../src/server/telegram/bot-api",{resolveBotActor:async()=>actor,isActorError:()=>false,requireBotManager:()=>null,domainError:()=>Response.json({ok:false})});
 route=require("../src/app/api/v1/bot/projects/[id]/route");
});
beforeEach(()=>{project={id:"j",title:"Old",clientId:"c",managerId:null,address:null,currency:"BYN",delivery:null,unloading:null,installation:null,initialPrice:null};logs.length=0;events.length=0;databaseCalls=0;});
const send=(body:unknown,id="j")=>route.PATCH(new Request(`http://localhost/api/v1/bot/projects/${id}`,{method:"PATCH",body:JSON.stringify(body),headers:{"content-type":"application/json"}}),{params:Promise.resolve({id})});
test("typed bot PATCH binds URI and rejects malformed closed field before domain calls",async()=>{
 const response=await send({projectId:"other",field:"title",value:"New",expectedValue:"Old",clientMutationId:randomUUID()});assert.equal(response.status,400);assert.equal(databaseCalls,0);
 const wrong=await send({projectId:"j",field:"initialPrice",value:"1",expectedValue:null,clientMutationId:randomUUID()});assert.equal(wrong.status,400);assert.equal(databaseCalls,0);assert.equal(project.title,"Old");
});
test("same typed bot payload after lost ACK reuses actual receipt and avoids duplicate effects",async()=>{
 const input={projectId:"j",field:"title",value:"New",expectedValue:"Old",clientMutationId:randomUUID()};
 const one=await(await send(input)).json();const two=await(await send(input)).json();
 assert.equal(one.ok,true);assert.equal(two.ok,true);assert.equal(two.repeated,true);assert.equal(project.title,"New");assert.equal(logs.length,1);assert.equal(events.length,1);
});
