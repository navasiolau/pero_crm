import assert from "node:assert/strict";
import test from "node:test";
import { readSketchUploadConfirmation, isConfirmedSketchDelete } from "../src/lib/product-sketch-ui";
const ack={ok:true,id:"file-id",sketchFileId:"file-id",clientMutationId:"mutation",sketch:{id:"file-id",fileName:"confirmed.png",mimeType:"image/png",hasThumb:true}};
test("only matching actual pointer/file ACK supplies the confirmed preview; replay remains valid",()=>{
  assert.deepEqual(readSketchUploadConfirmation({...ack,repeated:true},"mutation"),ack.sketch);
  for(const result of [null,{...ack,ok:false},{...ack,sketchFileId:"other"},{...ack,clientMutationId:"other"},{...ack,sketch:{...ack.sketch,id:"foreign"}},{...ack,sketch:{...ack.sketch,mimeType:"text/html"}},{...ack,sketch:null}])assert.throws(()=>readSketchUploadConfirmation(result,"mutation"));
});
test("failed, stale or malformed delete ACK never clears current confirmed source",()=>{
  assert.equal(isConfirmedSketchDelete({ok:true,sketchFileId:null,clientMutationId:"mutation",repeated:true},"mutation"),true);
  for(const result of [null,{ok:false,sketchFileId:null,clientMutationId:"mutation"},{ok:true,sketchFileId:"next",clientMutationId:"mutation"},{ok:true,sketchFileId:null,clientMutationId:"other"}])assert.equal(isConfirmedSketchDelete(result,"mutation"),false);
});
