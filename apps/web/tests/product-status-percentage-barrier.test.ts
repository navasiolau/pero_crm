import assert from "node:assert/strict";
import test from "node:test";
import {createSinglePercentageControllers} from "../src/lib/single-percentage-controller";
import {createInlineSaveController,type InlineValue} from "../src/lib/inline-save-controller";
import {flushProductStatusBarrier} from "../src/lib/product-status-barrier";
test("readonly clean percentage guard never posts even noncanonical Decimal baseline while technical draft is awaited",async()=>{
 let patchCalls=0;const group=createSinglePercentageControllers({productId:"p",kind:"ENGINEERING",revision:1,initial:{ratePercent:"5",assigneeId:"engineer"},save:async()=>{patchCalls++;return{ok:false,kind:"forbidden",error:"No management write permission"};}});
 let release!:(value:{kind:"saved";value:string})=>void;const technical=createInlineSaveController<InlineValue>({initialValue:"before",format:String,parse:String,save:async()=>new Promise(done=>{release=done;})});
 technical.setDraft("after");let settled=false;const wait=flushProductStatusBarrier([technical],[()=>group.flush()]).then(result=>{settled=true;return result;});await Promise.resolve();assert.equal(settled,false);release({kind:"saved",value:"after"});assert.equal(await wait,true);assert.equal(patchCalls,0);assert.equal(group.controllers.ratePercent.getSnapshot().status,"idle");
});
test("dirty percentage permission failure continues to block status without a save permission bypass",async()=>{
 let patchCalls=0;const group=createSinglePercentageControllers({productId:"p",kind:"ENGINEERING",revision:1,initial:{ratePercent:"5",assigneeId:"engineer"},save:async()=>{patchCalls++;return{ok:false,kind:"forbidden",error:"No management write permission"};}});
 group.controllers.ratePercent.setDraft("6");assert.equal(await group.flush(),false);assert.equal(patchCalls,1);assert.equal(group.controllers.ratePercent.getSnapshot().status,"error");
});
