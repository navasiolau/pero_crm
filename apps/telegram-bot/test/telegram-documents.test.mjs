import assert from 'node:assert/strict';
import test from 'node:test';
import {documentFromMessage,downloadTelegramDocument,TELEGRAM_DOCUMENT_MAX_BYTES} from '../dist/telegram-documents.js';

const attachment={fileId:'file',uniqueId:'unique',fileName:'Чек.pdf',mimeType:'application/pdf',size:4};
test('document metadata is preserved and photo chooses largest dimensions',()=>{
 assert.deepEqual(documentFromMessage({message_id:1,chat:{id:1},document:{file_id:'file',file_unique_id:'unique',file_name:'Чек.pdf',mime_type:'application/pdf',file_size:4}}),attachment);
 assert.equal(documentFromMessage({message_id:2,chat:{id:1},photo:[{file_id:'large',file_unique_id:'large',width:100,height:100},{file_id:'small',file_unique_id:'small',width:10,height:10}]}).fileId,'large');
 assert.equal(documentFromMessage({message_id:3,chat:{id:1},text:'text'}),null);
});
test('download stays on configured origin and preserves exact bytes',async()=>{
 let requested;
 const bytes=await downloadTelegramDocument(attachment,{origin:'http://127.0.0.1:9080',token:'fixture-secret',getFile:async id=>{assert.equal(id,'file');return{file_path:'documents/file_1.pdf',file_size:4}},fetchFile:async(url,options)=>{requested={url,options};return new Response('%PDF',{headers:{'content-length':'4'}})}});
 assert.equal(bytes.toString(),'%PDF');assert.equal(new URL(requested.url).origin,'http://127.0.0.1:9080');assert.equal(requested.options.redirect,'error');
});
test('metadata, body limit, unsafe paths and transport errors fail without leaking bot token',async()=>{
 let calls=0;const dependencies={origin:'http://127.0.0.1:9080',token:'fixture-secret',getFile:async()=>({file_path:'documents/f.pdf'}),fetchFile:async()=>{calls++;return new Response('%PDF')}};
 await assert.rejects(downloadTelegramDocument({...attachment,size:TELEGRAM_DOCUMENT_MAX_BYTES+1},dependencies),/20 МБ/);assert.equal(calls,0);
 for(const file_path of ['https://other.invalid/a','../secret','/absolute','files/%2e%2e/a','files\\a'])
  await assert.rejects(downloadTelegramDocument(attachment,{...dependencies,getFile:async()=>({file_path})}),/путь/);
 assert.equal(calls,0);
 await assert.rejects(downloadTelegramDocument({...attachment,size:undefined},{...dependencies,fetchFile:async()=>new Response(new Uint8Array(TELEGRAM_DOCUMENT_MAX_BYTES+1))}),/20 МБ/);
 await assert.rejects(downloadTelegramDocument(attachment,{...dependencies,fetchFile:async()=>{throw Error('https://api.telegram.org/file/botfixture-secret/a')}}),error=>!error.message.includes('fixture-secret'));
 await assert.rejects(downloadTelegramDocument(attachment,{...dependencies,getFile:async()=>({file_path:'documents/f.pdf',file_size:8})}),/не полностью/);
});
