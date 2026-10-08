import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
process.env.BOT_RECOVERY_TEST='1';process.env.TELEGRAM_API_ORIGIN='http://127.0.0.1:9080';
process.env.TELEGRAM_BOT_TOKEN='fixture-token';process.env.CRM_BASE_URL='http://127.0.0.1:9081';process.env.CRM_API_TOKEN='fixture-crm-token';
const sent=[],calls=[],uploads=new Map(),payments=new Map(),roles=new Map();
let loseUpload=false,losePayment=false;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input));
 let body;
 if(options.body instanceof FormData){const file=options.body.get('file');body={clientMutationId:options.body.get('clientMutationId'),fileName:file.name,mimeType:file.type,bytes:Buffer.from(await file.arrayBuffer()).toString('hex')};}
 else body=options.body?JSON.parse(String(options.body)):undefined;
 calls.push({path:url.pathname,body,actor:options.headers?.['x-acting-user']});
 let result;
 if(url.pathname.endsWith('/sendMessage')){sent.push(body);result={ok:true,result:{message_id:sent.length,chat:{id:body.chat_id}}};}
 else if(url.pathname.endsWith('/answerCallbackQuery'))result={ok:true,result:true};
 else if(url.pathname.endsWith('/getFile'))result={ok:true,result:{file_path:'documents/file.pdf',file_size:4}};
 else if(url.pathname.startsWith('/file/'))return new Response('%PDF',{headers:{'content-length':'4'}});
 else if(url.pathname==='/api/v1/bot/session'){const id=url.searchParams.get('chatId');result={ok:true,found:true,user:{id:'actor-'+id,name:'Actor',roles:roles.get(id)??['PROCUREMENT'],botAllowed:true}};}
 else if(url.pathname==='/api/v1/bot/projects')result={ok:true,projects:[{id:'project',number:'205',title:'Order',currency:'BYN'}]};
 else if(url.pathname==='/api/v1/bot/directory'){result={ok:true,items:url.searchParams.get('type')==='cash'?[{id:'cash',label:'Касса',currency:'BYN'}]:[{id:'article',label:'Материалы'}]};}
 else if(url.pathname==='/api/v1/bot/documents/upload'){
  if(!uploads.has(body.clientMutationId))uploads.set(body.clientMutationId,{id:randomUUID(),fileName:body.fileName,mimeType:body.mimeType});
  result={ok:true,document:uploads.get(body.clientMutationId)};if(loseUpload){loseUpload=false;throw Error('lost upload ACK');}
 }else if(url.pathname==='/api/v1/bot/payments'){
  assert.ok(body.reportDocumentId);assert.ok(body.clientMutationId);
  if(!payments.has(body.clientMutationId))payments.set(body.clientMutationId,body);
  result={ok:true};if(losePayment){losePayment=false;throw Error('lost payment ACK');}
 }else throw Error('Unexpected fixture URL');
 return Response.json(result);
};
const {handleUpdate}=await import('../dist/engine.js');
let updateId=1;
const message=(chatId,text,extra={})=>({update_id:updateId++,message:{message_id:updateId,chat:{id:chatId},from:{id:chatId},...(text?{text}:{}),...extra}});
const callback=(chatId,data)=>({update_id:updateId++,callback_query:{id:String(updateId),from:{id:chatId},message:{message_id:updateId,chat:{id:chatId}},data}});
const latestButton=(chatId,prefix)=>sent.filter(row=>row.chat_id===chatId).flatMap(row=>row.reply_markup?.inline_keyboard?.flat()??[]).filter(row=>row.callback_data?.startsWith(prefix)).at(-1)?.callback_data;
async function begin(chatId){
 await handleUpdate(message(chatId,'/расход 205 100'));
 await handleUpdate(callback(chatId,'cur:BYN'));
 await handleUpdate(callback(chatId,'cash:cash'));
 await handleUpdate(callback(chatId,'art:article'));
}

test('procurement uploads PDF and both lost acknowledgements retry the same operation',async()=>{
 const chat=8801;await begin(chat);await handleUpdate(message(chat,'Комментарий'));
 const beforePay=payments.size,beforeUpload=uploads.size;
 await handleUpdate(callback(chat,'payok'));assert.equal(payments.size,beforePay);
 loseUpload=true;
 await handleUpdate(message(chat,null,{document:{file_id:'invoice',file_unique_id:'invoice',file_name:'Счёт.pdf',mime_type:'application/pdf',file_size:4}}));
 const retry=latestButton(chat,'docretry:');assert.ok(retry);assert.equal(uploads.size,beforeUpload+1);
 await handleUpdate(callback(chat,retry));assert.equal(uploads.size,beforeUpload+1);
 const confirm=latestButton(chat,'payok:');assert.ok(confirm);assert.ok(sent.at(-1).text.includes('Счёт.pdf'));
 await handleUpdate(callback(chat,'payok:'+randomUUID()));assert.equal(payments.size,beforePay);
 losePayment=true;await handleUpdate(callback(chat,confirm));assert.equal(payments.size,beforePay+1);
 await handleUpdate(callback(chat,confirm));assert.equal(payments.size,beforePay+1);
 const callsAfterSuccess=calls.filter(row=>row.path.endsWith('/payments')).length;
 await handleUpdate(callback(chat,confirm));assert.equal(calls.filter(row=>row.path.endsWith('/payments')).length,callsAfterSuccess);
 const uploadCalls=calls.filter(row=>row.path.endsWith('/documents/upload')&&row.actor==='actor-'+chat);
 assert.equal(uploadCalls.length,2);assert.equal(uploadCalls[0].body.clientMutationId,uploadCalls[1].body.clientMutationId);
});

test('photo can carry the comment and stale cash buttons cannot replace confirmed details',async()=>{
 const chat=8803;roles.set(String(chat),['ACCOUNTANT']);await begin(chat);
 await handleUpdate(message(chat,null,{caption:'Доставка материала',photo:[{file_id:'small',file_unique_id:'small',width:1,height:1,file_size:4},{file_id:'large',file_unique_id:'large',width:100,height:100,file_size:4}]}));
 const confirm=latestButton(chat,'payok:');assert.ok(confirm);assert.ok(sent.at(-1).text.includes('Доставка материала'));
 assert.ok(calls.some(row=>row.path.endsWith('/getFile')&&row.body.file_id==='large'));
 await handleUpdate(callback(chat,'cash:cash'));await handleUpdate(callback(chat,confirm));
 assert.ok([...payments.values()].some(row=>row.clientMutationId===confirm.slice(6)&&row.cashAccountId==='cash'));
});

test('pure manager, role revocation and group documents never reach the file provider',async()=>{
 const before=calls.filter(row=>row.path.endsWith('/getFile')).length;
 roles.set('8802',['MANAGER']);await handleUpdate(message(8802,'/расход 205 100'));
 const file={document:{file_id:'blocked',file_unique_id:'blocked',file_name:'x.pdf',mime_type:'application/pdf',file_size:4}};
 await handleUpdate(message(8802,null,file));
 await begin(8804);roles.set('8804',['MANAGER']);await handleUpdate(message(8804,null,file));
 await handleUpdate(message(-100,null,{...file,from:{id:8801}}));
 assert.equal(calls.filter(row=>row.path.endsWith('/getFile')).length,before);
});
