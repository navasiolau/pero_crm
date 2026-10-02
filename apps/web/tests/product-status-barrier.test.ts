import assert from "node:assert/strict";
import test from "node:test";
import type { InlineSaveController, InlineValue } from "../src/lib/inline-save-controller";
import { createInlineSaveController } from "../src/lib/inline-save-controller";
import { flushProductStatusBarrier } from "../src/lib/product-status-barrier";
test("engineer status barrier never flushes clean readonly price/qty/assignment but runs every registered guard",async()=>{
 let posts=0,guards=0;const clean=["100.00",3,"engineer"].map(baseline=>({getSnapshot:()=>({baseline,draft:String(baseline),status:"idle"}),flush:async()=>{posts++;return false;}} as InlineSaveController));
 assert.equal(await flushProductStatusBarrier(clean,[async()=>{guards++;return true;},async()=>{guards++;return true;}]),true);assert.equal(posts,0);assert.equal(guards,2);
});
test("dirty technical draft is awaited and errors/conflicts block status",async()=>{
 let resolve!:(value:{kind:"saved";value:string})=>void;let posts=0,guard=0;
 const controller=createInlineSaveController<InlineValue>({initialValue:"old",format:String,parse:String,save:async()=>{posts++;return new Promise<{kind:"saved";value:string}>(done=>{resolve=done;});}});
 controller.setDraft("technical change");let settled=false;const barrier=flushProductStatusBarrier([controller],[async()=>{guard++;return true;}]).then(value=>{settled=true;return value;});
 await Promise.resolve();assert.equal(settled,false);assert.equal(posts,1);resolve({kind:"saved",value:"technical change"});assert.equal(await barrier,true);assert.equal(guard,1);
 for(const status of ["error","conflict","saving","dirty"] as const){const failed={getSnapshot:()=>({baseline:"same",draft:"same",status}),flush:async()=>false} as InlineSaveController;assert.equal(await flushProductStatusBarrier([failed],[]),false);}
 assert.equal(await flushProductStatusBarrier([],[async()=>false]),false);
});
