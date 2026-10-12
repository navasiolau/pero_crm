import assert from "node:assert/strict";
import test from "node:test";
import {createRequire,Module} from "node:module";
import type {Role} from "@prisma/client";
const require=createRequire(import.meta.url);
let roles:Role[]=["WORKER"];
let coordinates=0;
const database={
 $queryRaw:async()=>[],
 user:{findUnique:async()=>({active:true,roles}),findMany:async()=>[]},
 product:{findFirst:async()=>({id:"p",projectId:"j"}),findMany:async({where,select}:{where:{AND:{id?:string;projectId?:string}[]};select:Record<string,boolean>})=>{
  assert.deepEqual(select,{id:true,projectId:true});
  assert.ok(where.AND.some(part=>part.id==="p"&&part.projectId==="j"));
  coordinates++;return[{id:"p",projectId:"j"}];
 }},
 work:{findMany:async()=>[]},
 task:{findMany:async({where}:{where:{createdById?:string}})=>where.createdById?[{id:"t",title:"Задача коллеге",assignee:{name:"Коллега"},quantity:"2",status:"NEW",workId:"w",dueAt:null,executorShare:"1",allocationGroupId:null,shareAmount:null,allocationGroup:null,work:{priceSnapshot:"100"}}]:[]},
 orgSetting:{findUnique:async()=>({value:"BYN"})},
};
const filename=require.resolve("../src/lib/prisma"),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports={prisma:database};require.cache[filename]=stub;
const {listWorkerAllocationData}=require("../src/server/tasks/worker-allocation-queries") as typeof import("../src/server/tasks/worker-allocation-queries");
test("создатель-производственник не получает сумму задачи, назначенной коллеге",async()=>{
 roles=["WORKER"];coordinates=0;const view=await listWorkerAllocationData("creator","p");
 assert.equal(view.createdAssignments[0].rewardAmount,null);assert.equal(view.createdAssignments[0].rewardCurrency,null);assert.equal(view.createdAssignments[0].assigneeName,"Коллега");assert.equal(coordinates,1);
 roles=["WORKER","ACCOUNTANT"];assert.equal((await listWorkerAllocationData("creator","p")).createdAssignments[0].rewardAmount,"200.00");assert.equal(coordinates,2);
});
