import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, ProductStatus, Role } from "@prisma/client";
import { decideProductPercentageStatus } from "../src/lib/product-percentage-status";
import { productStatusTargets } from "../src/lib/product-percentage-ui";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { productVisibilityWhere, productEditWhere } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";
import { setProductNoModelCore } from "../src/server/product-percentage-pay/core";
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
