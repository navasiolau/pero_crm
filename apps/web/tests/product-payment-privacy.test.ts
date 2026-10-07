import assert from "node:assert/strict";
import test from "node:test";
import type {PrismaClient,Role} from "@prisma/client";
import {engineerFixture,matches} from "./helpers/visibility-fixture";
import {maskProductionRead} from "../src/server/access/production-read-projection";
import {productVisibilityWhere,productEditWhere,taskExecutionWhere} from "../src/server/access/visibility";
import {getProductPercentageView} from "../src/server/product-percentage-pay/queries";
import {navItemsForRole} from "../src/lib/nav";

test("стоимость назначенного изделия скрывается у всех трёх исполнителей",async()=>{
 const fixture=engineerFixture();
 for(const roles of [["ENGINEER"],["WORKER"],["MOUNTER"],["ENGINEER","WORKER"]] as Role[][]){
  const row=fixture.products[0] as {id:string;expectedPrice:unknown;initialPrice?:unknown};
  const masked=await maskProductionRead(fixture.db as unknown as PrismaClient,{id:"engineer",roles},[row]);
  assert.equal(masked[0].expectedPrice,null);
  assert.equal(masked[0].initialPrice,null);
  assert.equal(row.expectedPrice,100,"исходные данные нельзя менять");
 }
});

test("обе полевые роли видят последующие стадии, без подготовки, права записи или чужой задачи",()=>{
 const fixture=engineerFixture(),row=fixture.products[2];
 for(const role of ["WORKER","MOUNTER"] as const){
  const actor={id:"unassigned",roles:[role]};
  for(const status of ["PRODUCTION","STORAGE","INSTALLATION","DONE","RECLAMATION"]){row.status=status;assert.ok(matches(row,productVisibilityWhere(actor)),role+":"+status);assert.equal(matches(row,productEditWhere(actor)),false);}
  row.status="PREPARATION";assert.equal(matches(row,productVisibilityWhere(actor)),false);
  row.status="DESIGN";assert.equal(matches(row,productVisibilityWhere(actor)),false);
  assert.equal(fixture.tasks.some(task=>matches(task,taskExecutionWhere(actor))),false);
  assert.ok(navItemsForRole([role]).some(item=>item.href==="/products"));
 }
});

test("историческая сумма не раскрывается прежнему исполнителю в карточке нового получателя",async()=>{
 const product={id:"p",quantity:3,expectedPrice:"1000",project:{currency:"BYN"},noModel:false,files:[],stagePayPools:[],engineerId:null,engineer:null,assemblerId:"current",assembler:{name:"Новый сборщик",active:true,roles:["WORKER"]},mounterId:null,mounter:null,
  percentageConfigs:[{kind:"ASSEMBLY",ratePercent:"6",revision:2}],
  percentageCompletions:[{kind:"ASSEMBLY",state:"SETTLED",amount:"150",priceSnapshot:"1000",quantitySnapshot:3,ratePercentSnapshot:"5",productCurrency:"BYN",payrollCurrency:"BYN",calculationVersion:4,shares:[{userId:"previous",userNameSnapshot:"Прежний сборщик",shareUnits:1000000,amount:"150",adjustments:[]}]}]};
 const database={task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]}} as unknown as Parameters<typeof getProductPercentageView>[2];
 const old=await getProductPercentageView({id:"previous",roles:["WORKER"]},"p",database);
 assert.equal(old.sections.ASSEMBLY.ownMember,null);assert.equal(old.sections.ASSEMBLY.total,null);assert.deepEqual(old.sections.ASSEMBLY.members,[]);
 const current=await getProductPercentageView({id:"current",roles:["WORKER"]},"p",database);
 assert.equal(current.sections.ASSEMBLY.total,"180.00");
 for(const field of ["price","unitPrice","productTotal","ratePercent","currentRatePercent"] as const)assert.equal(current.sections.ASSEMBLY[field],null);
});

test("защищённый старый инженерный пул не скрывает текущий прогноз выбранного инженера",async()=>{
 const product={id:"p",quantity:3,expectedPrice:"1000",project:{currency:"BYN"},noModel:false,files:[],stagePayPools:[{state:"SETTLED",settlement:null}],percentageCompletions:[],engineerId:"eng",engineer:{name:"Инженер",active:true,roles:["ENGINEER"]},assemblerId:null,assembler:null,mounterId:null,mounter:null,percentageConfigs:[{kind:"ENGINEERING",ratePercent:"6",revision:2}]};
 const database={task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]}} as unknown as Parameters<typeof getProductPercentageView>[2];
 const own=await getProductPercentageView({id:"eng",roles:["ENGINEER"]},"p",database),manager=await getProductPercentageView({id:"manager",roles:["MANAGER"]},"p",database);
 assert.equal(own.sections.ENGINEERING.total,"60.00");assert.equal(manager.sections.ENGINEERING.total,"60.00");
 assert.equal(own.sections.ENGINEERING.ratePercent,null);assert.equal(own.sections.ENGINEERING.price,null);
});
