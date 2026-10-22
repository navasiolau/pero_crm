import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
process.env.BOT_RECOVERY_TEST='1';process.env.TELEGRAM_API_ORIGIN='http://127.0.0.1:9080';
process.env.TELEGRAM_BOT_TOKEN='fixture-token';process.env.CRM_BASE_URL='http://127.0.0.1:9081';process.env.CRM_API_TOKEN='fixture-crm-token';
const sent=[],calls=[],uploads=new Map(),payments=new Map(),roles=new Map();
let loseUpload=false,losePayment=false,unknownPayment=false;
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
  if(body.direction==='EXPENSE')assert.ok(body.reportDocumentId||body.reportDocumentIds?.length);else assert.equal(body.expenseArticleId,undefined);assert.ok(body.clientMutationId);
  if(!payments.has(body.clientMutationId))payments.set(body.clientMutationId,body);
  result=unknownPayment?{ok:false,outcome:"UNKNOWN",retrySafe:true,error:"Подтверждение неизвестно"}:{ok:true};unknownPayment=false;if(losePayment){losePayment=false;throw Error('lost payment ACK');}
 }else throw Error('Unexpected fixture URL');
 return Response.json(result);
};
const {handleUpdate}=await import('../dist/engine.js');
const {hasUnresolvedDocumentAttempt,paymentReportDocumentInput}=await import('../dist/finance-document-upload.js');
const {crm}=await import('../dist/crm.js');
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
 await handleUpdate(callback(chat,latestButton(chat,'doccontinue:')));
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
 await handleUpdate(callback(chat,latestButton(chat,'doccontinue:')));
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

test('explicit organization context supports income and documented expense without a project',async()=>{
 for(const [chat,direction] of [[8810,'INCOME'],[8811,'EXPENSE']]){
  await handleUpdate(message(chat,direction==='INCOME'?'/приход':'/расход'));
  const choice=latestButton(chat,'paygeneral:');assert.ok(choice);
  await handleUpdate(callback(chat,'paygeneral:'+randomUUID()));
  await handleUpdate(callback(chat,choice));await handleUpdate(message(chat,'100'));
  await handleUpdate(callback(chat,'cur:BYN'));await handleUpdate(callback(chat,'cash:cash'));
  if(direction==='EXPENSE')await handleUpdate(callback(chat,'art:article'));
  await handleUpdate(message(chat,'Общая операция'));
  if(direction==='EXPENSE'){
   await handleUpdate(message(chat,null,{document:{file_id:'general',file_unique_id:'general',file_name:'Общий расход.pdf',mime_type:'application/pdf',file_size:4}}));
   await handleUpdate(callback(chat,latestButton(chat,'doccontinue:')));
  }
  const confirmation=latestButton(chat,'payok:');assert.ok(confirmation);
  assert.ok(sent.at(-1).text.includes('организации'));assert.ok(!sent.at(-1).text.includes('undefined'));
  await handleUpdate(callback(chat,confirmation));
  const saved=payments.get(confirmation.slice(6));assert.equal(saved.projectId,null);assert.equal(saved.direction,direction);
 }
});

test('UNKNOWN payment body keeps the existing dialog and retries the identical UUID/payload',async()=>{
 const chat=8817;await begin(chat);await handleUpdate(message(chat,'Комментарий'));
 await handleUpdate(message(chat,null,{document:{file_id:'unknown-invoice',file_unique_id:'unknown-invoice',file_name:'Счёт.pdf',mime_type:'application/pdf',file_size:4}}));
 await handleUpdate(callback(chat,latestButton(chat,'doccontinue:')));
 const confirm=latestButton(chat,'payok:');assert.ok(confirm);
 const before=payments.size;unknownPayment=true;
 await handleUpdate(callback(chat,confirm));assert.equal(payments.size,before+1);
 const first=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat).at(-1);
 assert.ok(sent.at(-1).text.includes('Подтверждение неизвестно'));
 await handleUpdate(callback(chat,confirm));assert.equal(payments.size,before+1);
 const retry=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat).at(-1);
 assert.deepEqual(retry.body,first.body);assert.equal(retry.body.clientMutationId,first.body.clientMutationId);
 const count=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat).length;
 await handleUpdate(callback(chat,confirm));assert.equal(calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat).length,count);
});

test('three expense files keep READY list and retry only uncertain file before explicit continue',async()=>{
 const chat=8820;await begin(chat);await handleUpdate(message(chat,'Три подтверждения'));
 const send=index=>handleUpdate(message(chat,null,{document:{file_id:'multi-'+index,file_unique_id:'multi-'+index,file_name:`Документ-${index}.pdf`,mime_type:'application/pdf',file_size:4}}));
 await send(1);assert.equal(latestButton(chat,'payok:'),undefined);
 const continueFirst=latestButton(chat,'doccontinue:');loseUpload=true;await send(2);
 await handleUpdate(callback(chat,continueFirst));assert.equal(latestButton(chat,'payok:'),undefined);
 await send(3);assert.match(sent.at(-1).text,/Сначала повторите/);
 await handleUpdate(callback(chat,latestButton(chat,'docretry:')));await send(3);
 await handleUpdate(callback(chat,latestButton(chat,'doccontinue:')));
 assert.match(sent.at(-1).text,/Документ-1.pdf.*Документ-2.pdf.*Документ-3.pdf/);
 const confirm=latestButton(chat,'payok:');losePayment=true;await handleUpdate(callback(chat,confirm));await handleUpdate(callback(chat,confirm));
 const fileCalls=calls.filter(row=>row.path.endsWith('/documents/upload')&&row.actor==='actor-'+chat);
 assert.equal(fileCalls.length,4);assert.deepEqual(fileCalls[1].body,fileCalls[2].body);
 const writes=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat);
 assert.equal(writes.length,2);assert.equal(writes[0].body.reportDocumentIds.length,3);assert.deepEqual(writes[0].body,writes[1].body);
 assert.equal(Object.hasOwn(writes[0].body,'reportDocumentId'),false);
});

test('legacy READY single-file state keeps its old UNKNOWN payload despite a retained upload attempt',async()=>{
 const id=randomUUID(),documentId=randomUUID();
 const legacy={reportDocument:{id:documentId,fileName:'Старый чек.pdf',mimeType:'application/pdf'},
  documentAttempt:{key:'legacy',clientMutationId:randomUUID(),attachment:{uniqueId:'legacy',fileId:'legacy',fileName:'Старый чек.pdf',mimeType:'application/pdf',size:4}}};
 assert.equal(hasUnresolvedDocumentAttempt(legacy),false);
 const original={clientMutationId:id,projectId:'project',direction:'EXPENSE',amount:100,currency:'BYN',cashAccountId:'cash',expenseArticleId:'article',reportDocumentId:documentId};
 const restored={...original,...paymentReportDocumentInput(legacy)};assert.deepEqual(restored,original);assert.equal(Object.hasOwn(restored,'reportDocumentIds'),false);
 unknownPayment=true;assert.equal((await crm.createPayment('legacy-actor',restored)).ok,false);
 assert.equal((await crm.createPayment('legacy-actor',restored)).ok,true);
 const sends=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='legacy-actor');assert.equal(sends.length,2);assert.deepEqual(sends[0].body,original);assert.deepEqual(sends[1].body,original);
 assert.equal(hasUnresolvedDocumentAttempt({...legacy,reportDocument:undefined}),true);
});
