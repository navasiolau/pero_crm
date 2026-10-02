import assert from "node:assert/strict";
import test from "node:test";
import {createInlineSaveController,type InlineValue} from "../src/lib/inline-save-controller";
import {flushSketchCriticalFields} from "../src/lib/product-sketch-ui";
function field(){return createInlineSaveController<InlineValue>({initialValue:"unchanged",format:value=>String(value),parse:raw=>raw,save:async request=>({kind:"saved",value:request.value})});}
test("cover operation leaves three untouched critical fields idle without adding Saved messages",async()=>{
 const controllers=[field(),field(),field()];assert.equal(await flushSketchCriticalFields(controllers),true);assert.deepEqual(controllers.map(controller=>controller.getSnapshot().status),["idle","idle","idle"]);
});
test("cover still awaits an actual dirty critical save and rejects its validation failure",async()=>{
 let complete!:(value:{kind:"validation";error:string})=>void;const pending=new Promise<{kind:"validation";error:string}>(done=>{complete=done});
 const dirty=createInlineSaveController<InlineValue>({initialValue:"old",format:value=>String(value),parse:raw=>raw,save:()=>pending});dirty.setDraft("new");const result=flushSketchCriticalFields([field(),dirty]);assert.equal(dirty.getSnapshot().status,"saving");complete({kind:"validation",error:"Cannot save"});assert.equal(await result,false);assert.equal(dirty.getSnapshot().draft,"new");
});
test("draft mismatch is flushed even if an older consumer leaves a saved flag",async()=>{
 const controller=field();controller.getSnapshot().status="saved";controller.getSnapshot().draft="changed";
 assert.equal(await flushSketchCriticalFields([controller]),true);assert.equal(controller.getSnapshot().baseline,"changed");
});
