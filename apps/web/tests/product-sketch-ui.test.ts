import assert from "node:assert/strict";
import test from "node:test";
import { readSketchUploadConfirmation, isConfirmedSketchDelete } from "../src/lib/product-sketch-ui";
import { randomUUID, createHash } from "node:crypto";
import { sketchUploadForm } from "../src/lib/product-sketch-upload";
const ack={ok:true,id:"file-id",sketchFileId:"file-id",clientMutationId:"mutation",sketch:{id:"file-id",fileName:"confirmed.png",mimeType:"image/png",hasThumb:true}};
test("only matching actual pointer/file ACK supplies the confirmed preview; replay remains valid",()=>{
  assert.deepEqual(readSketchUploadConfirmation({...ack,repeated:true},"mutation"),ack.sketch);
  for(const result of [null,{...ack,ok:false},{...ack,sketchFileId:"other"},{...ack,clientMutationId:"other"},{...ack,sketch:{...ack.sketch,id:"foreign"}},{...ack,sketch:{...ack.sketch,mimeType:"text/html"}},{...ack,sketch:null}])assert.throws(()=>readSketchUploadConfirmation(result,"mutation"));
});
test("failed, stale or malformed delete ACK never clears current confirmed source",()=>{
  assert.equal(isConfirmedSketchDelete({ok:true,sketchFileId:null,clientMutationId:"mutation",repeated:true},"mutation"),true);
  for(const result of [null,{ok:false,sketchFileId:null,clientMutationId:"mutation"},{ok:true,sketchFileId:"next",clientMutationId:"mutation"},{ok:true,sketchFileId:null,clientMutationId:"other"}])assert.equal(isConfirmedSketchDelete(result,"mutation"),false);
});

test('replacement form captures exact old pointer and original file bytes',async()=>{
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]),file=new File([bytes],'original.png',{type:'image/png'}),mutation=randomUUID();
 const form=sketchUploadForm(file,'project','product',mutation,'old-sketch');
 assert.equal(form.get('expectedSketchFileId'),'old-sketch');assert.equal(form.get('clientMutationId'),mutation);
 const stored=form.get('file') as File;
 assert.equal(stored.name,file.name);assert.equal(stored.type,file.type);
 assert.equal(createHash('sha256').update(new Uint8Array(await stored.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 assert.equal(sketchUploadForm(file,'project','product',randomUUID()).get('expectedSketchFileId'),'null');
});
