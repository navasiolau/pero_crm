import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {attachmentQaCases,attachmentUploadOwned,attachmentColumnShape,attachmentTitleShape,controlledClipboardDispatch} from './product-attachments-browser.mjs';
import {attachmentsJournalScope} from './product-attachments-stage-runner.mjs';
import {runCrmBrowserZoom} from './crm-browser-zoom.mjs';
const fixture={ids:{project:'p',productA:'a',productB:'b'},actors:{admin:{id:'admin'},engineer:{id:'engineer'}}};
test('finite nine upload cases use genuine PNG128x96, PDF, existing OTHER B3D and exact owned fields',async()=>{
 const cases=await attachmentQaCases(fixture);assert.equal(cases.length,9);assert.equal(new Set(cases.map(row=>row.name)).size,9);const image=cases.find(row=>row.key==='measurement');const metadata=await sharp(image.buffer).metadata();assert.equal(metadata.width,128);assert.equal(metadata.height,96);const legacy=cases.find(row=>row.key==='legacy-measurement');assert.equal(legacy.category,'MEASUREMENT');assert.equal(legacy.stage,'INSTALLATION');assert.ok(legacy.buffer.subarray(0,8).toString().startsWith('%PDF'));assert.equal(cases.find(row=>row.key==='b3d').category,'OTHER');const measurementCover=cases.find(row=>row.key==='measurement-cover');assert.equal(measurementCover.productId,fixture.ids.productB);assert.equal(measurementCover.category,'MEASUREMENT');assert.equal(measurementCover.stage,'INSTALLATION');assert.equal(measurementCover.assignCover,undefined);assert.equal(cases.find(row=>row.key==='cover').category,'PHOTO');assert.ok(cases.length<=12);
 for(const item of cases){const fields={projectId:'p',productId:item.productId,category:item.category,stage:item.stage,...(item.assignCover?{assignCover:'1'}:{})},file={name:item.name,mimeType:item.mimeType,size:item.buffer.length,hash:item.hash};assert.equal(attachmentUploadOwned({fields,file},fixture,cases),true);for(const extra of [{...fields,projectId:'foreign'},{...fields,productId:'foreign'},{...fields,taskId:'fake-task'},{...fields,unknown:'x'}])assert.equal(attachmentUploadOwned({fields:extra,file},fixture,cases),false);assert.equal(attachmentUploadOwned({fields,file:{...file,hash:'wrong'}},fixture,cases),false)}
});
test('640 is a container breakpoint independent of viewport; equal two columns or full stacked rows',()=>{
 assert.equal(attachmentColumnShape({width:640,production:{x:0,y:0,width:312,height:300},installation:{x:328,y:0,width:312,height:200}}).valid,true);assert.equal(attachmentColumnShape({width:639,production:{x:0,y:0,width:639,height:300},installation:{x:0,y:316,width:639,height:200}}).valid,true);assert.equal(attachmentColumnShape({width:639,production:{x:0,y:0,width:310,height:300},installation:{x:326,y:0,width:310,height:200}}).valid,false);
});
test('coordinator accepts only captured known scalar/noModel/cover/file journals',()=>{
 const id='b5428289-23f7-4e42-a967-212da990d141';const ownWrites=[{type:'field',actorId:'admin',productId:'a',field:'description',clientMutationId:id},{type:'no-model',actorId:'admin',productId:'a',before:false,value:true,ok:true},{type:'cover',actorId:'admin',productId:'a',previousFileId:null,fileId:'f',ok:true},{type:'file-upload',actorId:'admin',productId:'a',fileId:'f',saved:true}];assert.deepEqual(attachmentsJournalScope(fixture,{ownWrites,preferenceOwnWrites:[]}),{mutationIds:[id],noModelWrites:[{actorId:'admin',productId:'a',before:false,value:true,ok:true}],coverWrites:[{actorId:'admin',productId:'a',previousFileId:null,fileId:'f',ok:true}]});for(const bad of [{...ownWrites[0],actorId:'foreign'},{...ownWrites[0],field:'expectedPrice'},{...ownWrites[1],ok:false},{...ownWrites[2],previousFileId:'existing'}])assert.throws(()=>attachmentsJournalScope(fixture,{ownWrites:[bad]}),/STOP/);
});
test('attachments truezoom requires the explicit owned mode/selector before launching Chromium',async()=>{
 const base={origin:'http://127.0.0.1:3020',pagePath:'/products/1.1',ownedProductPaths:['/products/1.1'],readySelector:'[data-product-documents]',attachmentsMode:{productId:'b5428289-23f7-4e42-a967-212da990d141'},onOwnWrites:async()=>{},profile:{roles:['ADMIN'],cookies:[{name:'test',value:'not-live'}]},outputDir:'not-used'};await assert.rejects(runCrmBrowserZoom({...base,attachmentsMode:null}),/ATTACHMENTS20_ZOOM_MODE_REQUIRED/);await assert.rejects(runCrmBrowserZoom({...base,readySelector:'#product-inline-title'}),/ATTACHMENTS_ZOOM_SELECTOR_REQUIRED/);await assert.rejects(runCrmBrowserZoom({...base,attachmentsMode:{productId:'foreign'}}),/OWNED_PRODUCT_REQUIRED/);
});


test('PDF browser uses the proven native Chromium new headless channel and retains inline popup checks',async()=>{
 const source=await readFile(new URL('./product-attachments-browser.mjs',import.meta.url),'utf8');assert.match(source,/chromium\.launch\(\{headless:true,channel:"chromium"\}\)/);assert.match(source,/browserMode:'Chromium new headless \(PDF-capable\); not headless-shell'/);assert.match(source,/popup\.waitForURL/);assert.match(source,/url\.searchParams\.get\('view'\)==='1'/);assert.match(source,/pdfView\.headers\(\)\['content-disposition'\],\/inline/i);
});

test('NoModel QA targets the accessible named checkbox, preserving hidden Base UI input internals',async()=>{
 const source=await readFile(new URL('./product-attachments-browser.mjs',import.meta.url),'utf8');assert.match(source,/getByRole\('checkbox',\{name:'Модели нет',exact:true\}\)/);assert.doesNotMatch(source,/locator\('#product-no-model'\)/);assert.doesNotMatch(source,/checkbox\.click\(\{force:true/);assert.match(source,/await expect\(checkbox\)\.toBeVisible\(\)/);
});


test('title geometry rejects collapsed20px fields and label/action overlaps even without global page overflow',()=>{
 const metrics={row:{x:0,y:0,width:340,height:90},input:{x:32,y:46,width:308,height:36},label:{x:32,y:22,width:140,height:16},actions:{x:0,y:102,width:340,height:60},parentWidth:308,arrowWidth:20,gap:12,controls:[{y:102}]};assert.equal(attachmentTitleShape(metrics).valid,true);assert.equal(attachmentTitleShape({...metrics,input:{...metrics.input,width:20}}).valid,false);assert.equal(attachmentTitleShape({...metrics,parentWidth:0}).valid,false);assert.equal(attachmentTitleShape({...metrics,actions:{...metrics.actions,y:40}}).valid,false);assert.equal(attachmentTitleShape({...metrics,label:{...metrics.label,y:50}}).valid,false);
 const small={...metrics,row:{...metrics.row,width:208},input:{...metrics.input,width:176},parentWidth:176};assert.equal(attachmentTitleShape(small).valid,true);assert.equal(attachmentTitleShape(small).minimum,176);
});


test('measurement photo acceptance uses a visible dialog, controlled paste/drop and pending error with exact real context',async()=>{
 const source=await readFile(new URL('./product-attachments-browser.mjs',import.meta.url),'utf8');assert.match(source,/getByRole\('dialog',\{name:'Фото замера изделия',exact:true\}\)/);assert.match(source,/data-measurement-photo-dropzone/);assert.match(source,/new realm\.ClipboardEvent\('paste'/);assert.doesNotMatch(source,/dialog\.dispatchEvent\('paste'/);assert.match(source,/dispatchEvent\('drop',\{dataTransfer:data\}\)/);assert.match(source,/SIMULATED_DOM_PASTE/);assert.doesNotMatch(source,/navigator\.clipboard|readText\(|writeText\(/);assert.match(source,/toBeDisabled\(\)/);assert.match(source,/titleGeometry\(page,`title-usable-/);assert.match(source,/titleGeometry\(page,`title-expanded-sidebar-/);assert.match(source,/titleGeometry\(page,`title-smooth-/);
});


test('controlled paste constructs a ClipboardEvent with readable DataTransfer.files, rejecting generic/missing clipboard data',()=>{
 class Transfer{constructor(){this.files=[new File(['fixture'],'qa20-test.png',{type:'image/png'})]}}
 class Clipboard extends Event{constructor(type,options){super(type,options);this.clipboardData=options.clipboardData}}
 const target=new EventTarget(),data=new Transfer();let received;target.addEventListener('paste',event=>{received=event.clipboardData.files[0]});assert.deepEqual(controlledClipboardDispatch(target,data,{ClipboardEvent:Clipboard,DataTransfer:Transfer}),{type:'paste',fileCount:1,osClipboardTouched:false});assert.equal(received,data.files[0]);
 class BrokenClipboard extends Event{constructor(type,options){super(type,options)}}
 assert.throws(()=>controlledClipboardDispatch(target,data,{ClipboardEvent:BrokenClipboard,DataTransfer:Transfer}),/CONTROLLED_CLIPBOARD_EVENT_INVALID/);assert.throws(()=>controlledClipboardDispatch(target,{files:[]},{ClipboardEvent:Clipboard,DataTransfer:Transfer}),/CONTROLLED_CLIPBOARD_EVENT_INVALID/);
});
