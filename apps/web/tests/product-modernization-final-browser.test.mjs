import assert from 'node:assert/strict';
import test from 'node:test';
import {finalProductActionOwned,finalQaMedia,finalUploadOwned,runProductModernizationFinalBrowser} from './product-modernization-final-browser.mjs';
const fixture={ids:{project:'own-project',productA:'own-a',productB:'own-b',clientA:'client-a',clientB:'client-b'},paths:{productA:'/products/1.1',productB:'/products/1.2',project:'/projects/own-project'},actors:{admin:{id:'actor'}}};
const nonce='00000000-0000-4000-8000-000000000001';
test('final closed command guard forbids foreign/status/payment/frozen fields and arbitrary recipient',()=>{
 const patch={productId:'own-a',field:'quantity',value:3,expectedValue:1,clientMutationId:nonce};assert.equal(finalProductActionOwned(patch,fixture,fixture.paths.productA),'scalar');
 for(const value of [{...patch,productId:'foreign'},{...patch,field:'status'},{...patch,field:'initialPrice'},{...patch,clientMutationId:'guess'}])assert.equal(finalProductActionOwned(value,fixture,fixture.paths.productA),null);
 const percent={productId:'own-a',kind:'ASSEMBLY',field:'ratePercent',value:'0',expectedValue:null,expectedRevision:0,clientMutationId:nonce};assert.equal(finalProductActionOwned(percent,fixture,fixture.paths.productA),'percentage');assert.equal(finalProductActionOwned({...percent,field:'assigneeId',value:'foreign'},fixture,fixture.paths.productA),null);
});
test('media guard preserves exact bytes/context and cover empty CAS while allowing only own flat project file',async()=>{
 const cases=await finalQaMedia(fixture),cover=cases.find(row=>row.cover),project=cases.find(row=>row.key==='project');
 const file=row=>({name:row.name,mimeType:row.mimeType,size:row.buffer.length,hash:row.hash});
 const fields={projectId:fixture.ids.project,productId:fixture.ids.productA,category:'PHOTO',assignCover:'1',expectedSketchFileId:'null',clientMutationId:nonce};
 assert.equal(finalUploadOwned(fields,file(cover),fixture,cases),true);assert.equal(finalUploadOwned({...fields,expectedSketchFileId:'old'},file(cover),fixture,cases),false);assert.equal(finalUploadOwned(fields,{...file(cover),hash:'forged'},fixture,cases),false);
 assert.equal(finalUploadOwned({projectId:fixture.ids.project,category:'DOCUMENT'},file(project),fixture,cases),true);assert.equal(finalUploadOwned({projectId:'foreign',category:'DOCUMENT'},file(project),fixture,cases),false);
});
test('import/default authorization cannot launch a browser',async()=>{await assert.rejects(runProductModernizationFinalBrowser({}),/FINAL_ROOT_EXECUTION_AUTH_REQUIRED/);});

test('actual generic File CUID and explicit cover UUID are accepted; arbitrary/traversal IDs remain rejected',async()=>{
 const {finalFileId}=await import('./product-modernization-final-browser.mjs');
 assert.equal(finalFileId('c'+'a'.repeat(24)),true);assert.equal(finalFileId(nonce),true);
 for(const value of [null,'foreign','c'+'a'.repeat(23),'../file','c'+ '/'.repeat(24)])assert.equal(finalFileId(value),false);
});

test('installed BaseUI checkbox exposes visible role separately from its native hidden input id',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{Checkbox}=await import('../src/components/ui/checkbox.tsx');
 const previous=globalThis.React;globalThis.React=React;
 try{const html=renderToStaticMarkup(React.createElement(Checkbox,{id:'product-no-model'}));assert.match(html,/<span[^>]*role="checkbox"[^>]*>/);const native=html.match(/<input[^>]*id="product-no-model"[^>]*>/)?.[0];assert.ok(native);assert.match(native,/aria-hidden="true"/);assert.match(html,/data-slot="checkbox"/);}finally{globalThis.React=previous;}
});
