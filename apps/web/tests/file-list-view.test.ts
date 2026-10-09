import assert from "node:assert/strict";
import test from "node:test";
import type {Prisma, Role} from "@prisma/client";
import {ordinaryFileListView, type OrdinaryFileForList} from "../src/server/files/list-view";

function fixture({status="DESIGN",engineerId="engineer",participant=false,taskOwner="worker"}: {status?: string;engineerId?: string;participant?: boolean;taskOwner?: string}={}) {
  let contextReads=0;
  const db={
    project:{findFirst:async()=>{contextReads++;return{id:"project",number:"QA115",products:[{id:"product"}],tasks:[{id:"task"}]};}},
    product:{findFirst:async()=>({id:"product",number:"QA115.1",engineerId,status})},
    task:{findMany:async()=>participant?[{id:"task",productId:"product",projectId:"project",product:{projectId:"project"},work:{productId:"product",projectId:"project"}}]:[],findFirst:async()=>({productId:"product",assigneeId:taskOwner})},
    file:{delete:async()=>{throw Error("PROJECTION_WRITE_FORBIDDEN")}},
  } as unknown as Prisma.TransactionClient;
  const file:OrdinaryFileForList={id:"file",fileName:"Исходное имя.v2.png",mimeType:"image/png",section:"MEASUREMENT",uploadedById:"engineer",projectId:"project",productId:"product",taskId:null};
  return{db,file,get contextReads(){return contextReads;}};
}
const actor=(id:string,roles:Role[])=>({id,roles});

test("ordinary projection strips audit/context metadata and preserves the exact filename section and immutable source",async()=>{
 const f=fixture(),original={...f.file,size:200,storedName:"private-key",createdAt:new Date(0)},before=structuredClone(original);
 const [view]=await ordinaryFileListView(f.db,actor("manager",["MANAGER"]),[original]);
 assert.deepEqual(Object.keys(view).sort(),["id","fileName","mimeType","section","canDelete"].sort());
 assert.equal(view.fileName,original.fileName);assert.equal(view.section,"MEASUREMENT");assert.equal(view.canDelete,true);assert.deepEqual(original,before);assert.equal(f.contextReads,0);
});

test("own assigned engineer can delete in DESIGN while a foreign uploader remains unavailable",async()=>{
 const f=fixture();const views=await ordinaryFileListView(f.db,actor("engineer",["ENGINEER"]),[f.file,{...f.file,id:"foreign",uploadedById:"someone"}]);
 assert.deepEqual(views.map(view=>view.canDelete),[true,false]);
});

test("live stale status and current participant assignment follow the existing exact permission policy",async()=>{
 const stale=fixture({status:"PRODUCTION"});assert.equal((await ordinaryFileListView(stale.db,actor("engineer",["ENGINEER"]),[stale.file]))[0].canDelete,false);
 const member=fixture({engineerId:"someone",participant:true});assert.equal((await ordinaryFileListView(member.db,actor("engineer",["ENGINEER"]),[member.file]))[0].canDelete,true);
});

test("field user deletes only own file in its own task context",async()=>{
 const f=fixture(),file={...f.file,uploadedById:"worker",taskId:"task"};assert.equal((await ordinaryFileListView(f.db,actor("worker",["WORKER"]),[file]))[0].canDelete,true);
 const other=fixture({taskOwner:"someone"});assert.equal((await ordinaryFileListView(other.db,actor("worker",["WORKER"]),[file]))[0].canDelete,false);
});

test("readonly financial roles and missing actor never gain ordinary deletion rights",async()=>{
 const f=fixture();for(const roles of [["ACCOUNTANT"],["PROCUREMENT"],[]] as Role[][])assert.equal((await ordinaryFileListView(f.db,actor("engineer",roles),[f.file]))[0].canDelete,false);
 assert.equal((await ordinaryFileListView(f.db,undefined,[f.file]))[0].canDelete,false);
});