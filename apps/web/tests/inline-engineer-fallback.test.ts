import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";
import { initialProductPercentageParticipants } from "../src/lib/product-percentage-ui";
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
