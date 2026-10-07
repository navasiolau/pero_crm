import assert from "node:assert/strict";
import test from "node:test";
import {createRequire,Module} from "node:module";
import type {Role} from "@prisma/client";
const require=createRequire(import.meta.url);
let roles:Role[]=["WORKER"];
const database={
 $queryRaw:async()=>[],
 user:{findUnique:async()=>({active:true,roles}),findMany:async()=>[]},
 product:{findFirst:async()=>({id:"p",projectId:"j"})},
 work:{findMany:async()=>[]},
 task:{findMany:async({where}:{where:{createdById?:string}})=>where.createdById?[{id:"t",title:"Задача коллеге",assignee:{name:"Коллега"},quantity:"2",status:"NEW",workId:"w",dueAt:null,executorShare:"1",allocationGroupId:null,shareAmount:null,allocationGroup:null,work:{priceSnapshot:"100"}}]:[]},
 orgSetting:{findUnique:async()=>({value:"BYN"})},
};
const filename=require.resolve("../src/lib/prisma"),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports={prisma:database};require.cache[filename]=stub;
const {listWorkerAllocationData}=require("../src/server/tasks/worker-allocation-queries") as typeof import("../src/server/tasks/worker-allocation-queries");
test("создатель-производственник не получает сумму задачи, назначенной коллеге",async()=>{
 roles=["WORKER"];const view=await listWorkerAllocationData("creator","p");
 assert.equal(view.createdAssignments[0].rewardAmount,null);assert.equal(view.createdAssignments[0].rewardCurrency,null);assert.equal(view.createdAssignments[0].assigneeName,"Коллега");
 roles=["WORKER","ACCOUNTANT"];assert.equal((await listWorkerAllocationData("creator","p")).createdAssignments[0].rewardAmount,"200.00");
});
