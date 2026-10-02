import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeProductDescriptionAction} from './product-description-flight.mjs';
const patch={field:'description',clientMutationId:'b5428289-23f7-4e42-a967-212da990d141'};
async function encode(result,mode){const child=spawn(process.execPath,['--conditions=react-server',fileURLToPath(new URL('./helpers/product-description-flight-encode.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true});const out=[],err=[];child.stdout.on('data',chunk=>out.push(chunk));child.stderr.on('data',chunk=>err.push(chunk));child.stdin.end(JSON.stringify({result,mode}));const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});assert.equal(code,0,Buffer.concat(err).toString());return Buffer.from(Buffer.concat(out).toString(),'base64')}
const options=body=>({body,status:200,headers:{'content-type':'text/x-component','x-action-revalidated':'[[],0,0]'},patch});
test('genuine Next Flight long text/literal dollar escapes/unicode/newlines decode exact values',async()=>{
 for(const value of ['$2','$undefined','  Начало\n\t𠮷 Unicode\n\n'+('L'.repeat(2400))+'  \n\n']){const result={...patch,kind:'saved',value,derived:{}};const body=await encode(result);assert.deepEqual(await decodeProductDescriptionAction(options(body)),result);if(value.length>1024)assert.ok(body.toString().includes(':T'),'Genuine encoder did not emit a long-text chunk')}
});
test('strict compact decoder rejects genuine module/full-card metadata and mismatched owned result',async()=>{
 const result={...patch,kind:'saved',value:'value'};for(const [mode,code]of [['module',/MODULE_REFERENCE_FORBIDDEN/],['full-rsc',/FULL_RSC_FORBIDDEN/],['metadata',/ACTION_ENVELOPE_REQUIRED/]])await assert.rejects(decodeProductDescriptionAction(options(await encode(result,mode))),code);
 await assert.rejects(decodeProductDescriptionAction({...options(await encode({...result,clientMutationId:'foreign'}))}),/METADATA_MISMATCH/);
});
test('redirect/revalidation/content type are rejected before decoding the action promise',async()=>{
 const body=await encode({...patch,kind:'saved',value:'value'});for(const headers of [{'content-type':'text/x-component','x-action-redirect':'/other'},{'content-type':'text/x-component','x-action-revalidated':'[["/products"],0,0]'},{'content-type':'application/json'}])await assert.rejects(decodeProductDescriptionAction({...options(body),headers}),/REDIRECT|REVALIDATION|CONTENT_TYPE/);
});
