import assert from "node:assert/strict";
import {before,beforeEach,test} from "node:test";
import {createRequire,Module} from "node:module";
import {createHash,randomUUID} from "node:crypto";
import {archivedProjectStagePatchSchema} from "../src/server/projects/stage-contract";
import type {PrismaClient} from "@prisma/client";
const require=createRequire(import.meta.url);let route:typeof import("../src/app/api/v1/bot/projects/[id]/route");
let stageRoute:typeof import("../src/app/api/v1/bot/projects/[id]/stage/route");
let project={id:"j",number:"1",stage:"LEAD",title:"Old",clientId:"c",managerId:null,address:null,currency:"BYN",delivery:null,unloading:null,installation:null,initialPrice:null};
const logs:Record<string,unknown>[]=[];const events:unknown[]=[];let databaseCalls=0;
const actor={id:"m",name:"Manager",roles:["MANAGER"],source:"telegram"};
const db={$queryRaw:async()=>{databaseCalls++;return[];},project:{findUnique:async()=>({...project}),update:async({data}:{data:object})=>Object.assign(project,data)},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}},domainEvent:{create:async({data}:{data:unknown})=>{events.push(data);return{id:"e"};}},$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn(db)};
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(()=>{
 (globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;
 inject("../src/server/api/auth",{authenticate:async()=>({}),isErrorResponse:()=>false});
 inject("../src/server/telegram/bot-api",{resolveBotActor:async()=>actor,isActorError:()=>false,requireBotManager:()=>null,domainError:()=>Response.json({ok:false})});
 route=require("../src/app/api/v1/bot/projects/[id]/route");
 stageRoute=require("../src/app/api/v1/bot/projects/[id]/stage/route");
});
beforeEach(()=>{project={id:"j",number:"1",stage:"LEAD",title:"Old",clientId:"c",managerId:null,address:null,currency:"BYN",delivery:null,unloading:null,installation:null,initialPrice:null};logs.length=0;events.length=0;databaseCalls=0;});
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

test("bot stage transport reads an exact historical receipt but rejects a new retired transition",async()=>{
 const body={toStage:"RECLAMATION",expectedStage:"LEAD",clientMutationId:randomUUID(),extras:{reclamationReason:"история",reclamationDescription:"сохранена",reclamationFault:"архив"}};
 const fingerprint=createHash("sha256").update(JSON.stringify(archivedProjectStagePatchSchema.parse({projectId:"j",...body}))).digest("hex");
 logs.push({id:`project-stage:${body.clientMutationId}`,actorType:"user",actorId:actor.id,entity:"project",entityId:"j",action:"stage",field:"stage",newValue:{fingerprint,stage:body.toStage}});
 const sendStage=(input:unknown)=>stageRoute.POST(new Request("http://localhost/api/v1/bot/projects/j/stage",{method:"POST",body:JSON.stringify(input),headers:{"content-type":"application/json"}}),{params:Promise.resolve({id:"j"})});
 const historical=await(await sendStage(body)).json();assert.equal(historical.ok,true);assert.equal(historical.replayed,true);
 const fresh=await(await sendStage({...body,clientMutationId:randomUUID()})).json();assert.equal(fresh.ok,false);assert.equal(fresh.kind,"validation");
 assert.equal(project.stage,"LEAD");assert.equal(logs.length,1);assert.equal(events.length,0);
});
