import assert from "node:assert/strict";
import { test } from "node:test";
import { readSketchUploadConfirmation, isConfirmedSketchDelete, flushSketchCriticalFields } from "../src/lib/product-sketch-ui";
import { randomUUID, createHash } from "node:crypto";
import { sketchUploadForm } from "../src/lib/product-sketch-upload";
import { createInlineSaveController, type InlineValue } from "../src/lib/inline-save-controller";
import { measurementUploadFields, type MeasurementUploadContext } from "../src/lib/measurement-upload-context";
import { projectCoverAttempt, confirmedProjectCover } from "../src/lib/project-cover-upload";

// Источник: product-sketch-ui.test.ts
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

// Источник: product-sketch-clean-critical.test.ts
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

// Источник: sketch-upload-request.test.ts
test('sketch request uses originalbytes andexactemptyCAS/UUID withoutcaption or fabricatedMIME/stage',async()=>{const bytes=new Uint8Array([137,80,78,71,1,2,3]),file=new File([bytes],'original.png',{type:'image/png'}),id=randomUUID(),form=sketchUploadForm(file,'j','p',id);const sent=form.get('file') as File;assert.equal(sent.name,file.name);assert.equal(sent.type,file.type);assert.equal(createHash('sha256').update(Buffer.from(await sent.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));assert.equal(form.get('clientMutationId'),id);assert.equal(form.get('expectedSketchFileId'),'null');assert.equal(form.get('assignCover'),'1');assert.equal(form.get('section'),'PRODUCTION');assert.equal(form.get('category'),null);assert.equal(form.has('caption'),false);assert.equal(form.has('stage'),false);assert.throws(()=>sketchUploadForm(new File(['x'],'guess.png',{type:''}),'j','p',id),/поддерживаемого/);assert.throws(()=>sketchUploadForm(new File([],'empty.png',{type:'image/png'}),'j','p',id),/непустым/);});
test('clean nullable/quantity/legacyprice baselines flush withoutany readonlymonetary writes; dirtyinvalid stops',async()=>{let writes=0;const controllers=[null,3,'100.00','existingEngineer'].map(initialValue=>createInlineSaveController({initialValue,format:value=>value===null?'':String(value),parse:raw=>raw,save:async()=>{writes++;throw Error('READONLY_WRITE_FORBIDDEN')}}));assert.equal(await flushSketchCriticalFields(controllers),true);assert.equal(writes,0);const invalid=createInlineSaveController<InlineValue>({initialValue:3,format:String,parse:raw=>{const value=Number(raw);if(value<1)throw Error('Количество должно быть положительным');return value},save:async()=>{writes++;throw Error('INVALID_MUST_NOT_WRITE')}});invalid.setDraft('0');assert.equal(await flushSketchCriticalFields([invalid]),false);assert.equal(writes,0);});
test('only real matchedACK confirms preview; validation/error/inconsistentpointer remain visible failure',()=>{const id=randomUUID(),value={ok:true,id:'cmur230b00007vxswzgco1hfx',sketchFileId:'cmur230b00007vxswzgco1hfx',clientMutationId:id,sketch:{id:'cmur230b00007vxswzgco1hfx',fileName:'original.png',mimeType:'image/png',hasThumb:false}};assert.deepEqual(readSketchUploadConfirmation(value,id),value.sketch);for(const result of [{ok:false,error:'Denied'}, {...value,sketchFileId:'old'}, {...value,clientMutationId:randomUUID()}])assert.throws(()=>readSketchUploadConfirmation(result,id));});

// Источник: measurement-upload-context.test.ts
test("task and product measurement use exact real bindings and section without fake task or metadata", () => {
  assert.deepEqual(measurementUploadFields({projectId:"project",taskId:"task"}),{projectId:"project",taskId:"task",section:"MEASUREMENT"});
  assert.deepEqual(measurementUploadFields({projectId:"project",productId:"product"}),{projectId:"project",productId:"product",section:"MEASUREMENT"});
});
test("missing and mixed measurement contexts never form an upload", () => {
  for (const context of [{projectId:"project"},{projectId:"project",taskId:"task",productId:"product"},{projectId:"",productId:"product"}]) assert.throws(() => measurementUploadFields(context as MeasurementUploadContext));
});

// Источник: project-cover-upload.test.ts
test('project cover target preserves original bytes and has no fake product/task/caption/stage',async()=>{const file=new File(['original bytes'],'qa.png',{type:'image/png'}),attempt=projectCoverAttempt(file,'j');assert.equal(attempt.form.get('file'),file);assert.equal(await (attempt.form.get('file') as File).text(),'original bytes');assert.equal(attempt.form.get('assignProjectCover'),'1');assert.equal(attempt.form.get('expectedCoverFileId'),'null');for(const field of ['productId','taskId','caption','stage','assignCover'])assert.equal(attempt.form.get(field),null);assert.equal(attempt.form.get('clientMutationId'),attempt.clientMutationId);});
test('project preview requires exact CID/pointer/image ACK and never treats generic success as confirmation',()=>{const cover={id:'f',fileName:'qa.png',mimeType:'image/png',hasThumb:true},valid={ok:true,id:'f',coverFileId:'f',clientMutationId:'cid',cover};assert.deepEqual(confirmedProjectCover(valid,'cid'),cover);for(const data of [{...valid,clientMutationId:'other'},{...valid,coverFileId:'other'},{...valid,cover:null},{...valid,cover:{...cover,mimeType:'application/pdf'}}])assert.throws(()=>confirmedProjectCover(data,'cid'));});
