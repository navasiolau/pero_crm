import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeAttachmentAction,attachmentActionScope} from './product-attachments-flight.mjs';
const actionId='a'.repeat(40);const fixture={ids:{productA:'a',productB:'b'},actors:{admin:{id:'admin'}},paths:{productA:'/products/1.1',productB:'/products/1.2'},allowedFileIds:['file','b-measurement'],fileSubjects:{file:'a','b-measurement':'b'},actionIds:{'file-delete':actionId,'no-model':actionId,'cover-bind':actionId}};
const binding={fixture,actorId:'admin',path:fixture.paths.productA,actionId,scope:'file-delete',args:['file']};
async function encode(result){const child=spawn(process.execPath,['--conditions=react-server',fileURLToPath(new URL('./helpers/product-attachments-flight-encode.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,NODE_ENV:'production'}});const out=[],err=[];child.stdout.on('data',chunk=>out.push(chunk));child.stderr.on('data',chunk=>err.push(chunk));child.stdin.end(JSON.stringify({result}));const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});assert.equal(code,0,Buffer.concat(err).toString());return Buffer.from(Buffer.concat(out).toString(),'base64')}
test('real Next action bool/error resolves while nested fullRSC modules remain inert and never execute',async()=>{
 for(const result of [{ok:true},{ok:false,error:'Ошибка $2\nЮникод'},{ok:true,result:null}]){const scope=result.result===null?'no-model':'file-delete';const args=scope==='no-model'?[{productId:'a',noModel:true}]:['file'];const observed=await decodeAttachmentAction({...binding,scope,args,body:await encode(result),status:200,headers:{'content-type':'text/x-component'}});assert.equal(observed.ok,result.ok);assert.equal(observed.error,result.error);assert.equal(observed.observer.appModulesExecuted,0);assert.equal(observed.observer.inertFunctionCalls,0);assert.equal(observed.observer.fullRscDiscarded,true)}
});
test('observer rejects wrong actor/path/actionID/ownedargs and redirects before action decoding',async()=>{
 for(const bad of [{...binding,actorId:'other'},{...binding,path:'/products/foreign'},{...binding,actionId:'b'.repeat(40)},{...binding,args:['foreign']},{...binding,scope:'no-model',args:[{productId:'b',noModel:true}]},{...binding,scope:'no-model',args:[{productId:'a',noModel:true,kind:'extra'}]}])assert.throws(()=>attachmentActionScope(bad),/STOP/);
 await assert.rejects(decodeAttachmentAction({...binding,body:await encode({ok:true}),status:200,headers:{'content-type':'text/x-component','x-action-redirect':'/other'}}),/BOUNDARY_STOP/);
});




test('cover observer permits only existing admin setter for own B and its captured measurement file',async()=>{
 const cover={...binding,scope:'cover-bind',path:fixture.paths.productB,args:['b','b-measurement']};assert.equal(attachmentActionScope(cover),'cover-bind');const observed=await decodeAttachmentAction({...cover,body:await encode({ok:true}),status:200,headers:{'content-type':'text/x-component'}});assert.equal(observed.ok,true);assert.equal(observed.observer.inertFunctionCalls,0);
 for(const bad of [{...cover,path:fixture.paths.productA,args:['a','file']},{...cover,args:['b','file']},{...cover,args:['b','foreign']},{...cover,actorId:'other'},{...cover,actionId:'b'.repeat(40)}])assert.throws(()=>attachmentActionScope(bad),/STOP/);
});
