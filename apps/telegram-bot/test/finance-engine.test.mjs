import assert from 'node:assert/strict';
import { botUser, deniedMessage } from "./user-fixture.mjs";
import test from 'node:test';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
process.env.BOT_RECOVERY_TEST='1';process.env.TELEGRAM_API_ORIGIN='http://127.0.0.1:9080';
process.env.TELEGRAM_BOT_TOKEN='fixture-token';process.env.CRM_BASE_URL='http://127.0.0.1:9081';process.env.CRM_API_TOKEN='fixture-crm-token';
process.env.PERO_TELEGRAM_FINANCE_ORIGIN='https://crm.invalid';
const sent=[],calls=[],uploads=new Map(),payments=new Map(),roles=new Map(),bindings=new Map(),unlinked=new Set();
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
 else if(url.pathname==='/api/v1/bot/session'){const id=url.searchParams.get('chatId');result=unlinked.has(id)?{ok:true,found:false}:{ok:true,found:true,binding:bindings.get(id),user:botUser('actor-'+id,'Actor',roles.get(id)??['PROCUREMENT'])};}
 else if(url.pathname==='/api/v1/bot/link'){result={ok:false,error:'Код не найден или истёк'};}
 else if(url.pathname==='/api/v1/bot/projects'){
  const q=url.searchParams.get('q');
  result={ok:true,projects:q==='Шкаф'?[{id:'older',number:'204',title:'Шкаф в холл',currency:'BYN'},{id:'newer',number:'206',title:'Шкаф в спальню',currency:'BYN'}]:[{id:'project',number:'205',title:'Order',currency:'BYN'}]};
 }
 else if(url.pathname==='/api/v1/bot/directory'){result={ok:true,items:url.searchParams.get('type')==='cash'?[{id:'cash',label:'Касса',currency:'BYN'},{id:'usd',label:'USD',currency:'USD'},{id:'test-cash',label:' ТеСт ',currency:'USD'}]:[{id:'article',label:'Материалы'}]};}
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


test('ACCOUNTANT selects an ambiguous project explicitly and supplies date and manual rate', async () => {
 const chat=8832;roles.set(String(chat),['ACCOUNTANT']);
 await handleUpdate(message(chat,'/приход'));
 await handleUpdate(message(chat,'Шкаф'));
 const choices=sent.at(-1).reply_markup.inline_keyboard.flat().filter(button=>button.callback_data.startsWith('payproj:'));
 assert.equal(choices.length,2);
 await handleUpdate(callback(chat,choices[1].callback_data));
 assert.match(sent.at(-1).text,/П-206/);
 await handleUpdate(message(chat,'55'));
 await handleUpdate(callback(chat,'cur:USD'));
 await handleUpdate(callback(chat,'cash:usd'));
 await handleUpdate(message(chat,'—'));
 const options=sent.at(-1).reply_markup.inline_keyboard.flat().filter(button=>button.callback_data.startsWith('payoptions:'));
 await handleUpdate(callback(chat,options[0].callback_data));
 await handleUpdate(message(chat,'2026-02-31'));
 assert.match(sent.at(-1).text,/календарную дату/);
 await handleUpdate(message(chat,'2026-02-28'));
 await handleUpdate(callback(chat,options[1].callback_data));
 await handleUpdate(message(chat,'3,25'));
 await handleUpdate(callback(chat,latestButton(chat,'payok:')));
 const payment=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat).at(-1).body;
 assert.equal(payment.projectId,'newer');assert.equal(payment.paidAt,'2026-02-28');assert.equal(payment.rate,3.25);
});

test('private project list opens an accountant payment without a manager card and group link never reaches CRM', async () => {
 const chat=8833;roles.set(String(chat),['ACCOUNTANT']);
 const before=calls.length;
 await handleUpdate(message(-chat,'/start Secret',{from:{id:chat}}));
 await handleUpdate(message(-chat,'/проекты',{from:{id:chat}}));
 assert.equal(calls.length,before);
 await handleUpdate(message(chat,'/проекты'));
 await handleUpdate(callback(chat,latestButton(chat,'paylist:')));
 const income=sent.at(-1).reply_markup.inline_keyboard.flat().find(button=>button.callback_data.endsWith(':income'));
 await handleUpdate(callback(chat,income.callback_data));
 assert.match(sent.at(-1).text,/П-205/);
 assert.equal(calls.some(row=>row.actor==='actor-'+chat&&row.path.endsWith('/projects/project')),false);
});

test('back from a manual date restores the payment without allowing old confirmation buttons', async () => {
  const chat = 8844;
  roles.set(String(chat), ["ACCOUNTANT"]);
  bindings.set(String(chat), "payment-draft:1:0");
  const press = (match, sentId = sent.length) => {
    const button = sent[sentId - 1]?.reply_markup?.inline_keyboard?.flat().find(match);
    assert.ok(button?.callback_data);
    const update = callback(chat, button.callback_data);
    update.callback_query.message.message_id = sentId;
    return handleUpdate(update);
  };
  await handleUpdate(message(chat, "/приход 205 125,50"));
  await press(button => button.callback_data === "cur:USD");
  assert.doesNotMatch(JSON.stringify(sent.at(-1).reply_markup), /тест|test-cash/i);
  await press(button => button.callback_data === "cash:usd");
  await handleUpdate(message(chat, "Аванс клиента"));
  await press(button => button.text === "Дата оплаты");
  await handleUpdate(message(chat, "2026-11-12"));
  const summary = sent.at(-1).text;
  const oldSummary = sent.length;
  assert.match(summary, /Дата оплаты: 2026-11-12/);
  await press(button => button.text === "Дата оплаты");
  await handleUpdate(message(chat, "2026-11-31"));
  await press(button => button.text === "← Назад");
  assert.equal(sent.at(-1).text, summary);
  const validSummary = sent.length;
  await press(button => button.callback_data.startsWith("payok:"), oldSummary);
  assert.match(sent.at(-1).text, /Кнопка устарела/);
  assert.equal(calls.filter(row => row.path.endsWith("/payments") && row.actor === "actor-" + chat).length, 0);
  await press(button => button.callback_data.startsWith("payok:"), validSummary);
  const operations = calls.filter(row => row.path.endsWith("/payments") && row.actor === "actor-" + chat);
  assert.equal(operations.length, 1);
  const { body } = operations[0];
  assert.equal(body.amount, 125.5);
  assert.equal(body.paidAt, "2026-11-12");
  assert.equal(body.cashAccountId, "usd");
  assert.equal(body.comment, "Аванс клиента");
});

test("the command list uses the clearer names and the old retry name still works", async () => {
  const chat = 8845;
  roles.set(String(chat), ["ADMIN"]);
  await handleUpdate(message(chat, "/команды"));
  const help = sent.at(-1).text;
  assert.match(help, /^\/проверить_операцию — проверить, сохранилась ли операция$/m);
  assert.match(help, /^\/возврат_на_склад — вернуть ранее выданный материал$/m);
  assert.doesNotMatch(help, /^\/(повтор|возврат) —/m);
  await handleUpdate(message(chat, "/повтор"));
  assert.match(sent.at(-1).text, /Нет операций, которые нужно проверить/);
});

test('after restarting engine a lost payment acknowledgement is retried with the stored payload',async()=>{
 const chat=8834;roles.set(String(chat),['ACCOUNTANT']);
 await handleUpdate(message(chat,'/приход 205 100'));
 await handleUpdate(callback(chat,'cur:BYN'));await handleUpdate(callback(chat,'cash:cash'));
 await handleUpdate(message(chat,'—'));losePayment=true;
 await handleUpdate(callback(chat,latestButton(chat,'payok:')));
 const first=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat).at(-1);
 await handleUpdate(callback(chat,latestButton(chat,'draftback:')));
 assert.match(sent.at(-1).text,/проверить_операцию/);
 const require=createRequire(import.meta.url);
 for(const module of ['../dist/engine.js','../dist/finance-checkpoint.js'])delete require.cache[require.resolve(module)];
 const restarted=require('../dist/engine.js').handleUpdate;
 await restarted(message(chat,'/приход 205 100'));
 assert.match(sent.at(-1).text,/проверить_операцию/);
 await restarted(message(chat,'/проверить_операцию'));
 assert.match(sent.at(-1).text,/подтверждена/);
 const attempts=calls.filter(row=>row.path.endsWith('/payments')&&row.actor==='actor-'+chat);
 assert.equal(attempts.length,2);assert.deepEqual(attempts[1],first);
});

test('the Finance button uses a Mini App only for a linked financial user in a private chat', async () => {
 const chat=8835;roles.set(String(chat),['ACCOUNTANT']);
 await handleUpdate(message(chat,'/финансы'));
 assert.deepEqual(sent.at(-1).reply_markup.inline_keyboard[0][0],{text:'Финансы',web_app:{url:'https://crm.invalid/telegram/finance'}});
 const before=sent.length;
 await handleUpdate(message(-chat,'/финансы',{from:{id:chat}}));
 assert.equal(sent.length,before);
 roles.set(String(chat),['MANAGER']);
 await handleUpdate(message(chat,'/финансы'));
 assert.equal(sent.at(-1).text, deniedMessage);
 assert.equal(sent.at(-1).reply_markup,undefined);
});


test('native bot rejects callbacks from an older binding even for the same CRM actor and chat', async () => {
 const chat=8836;roles.set(String(chat),['ACCOUNTANT']);bindings.set(String(chat),'link:1:0');
 await handleUpdate(message(chat,'/приход'));
 const first=latestButton(chat,'paygeneral:');assert.ok(first);
 const firstMessage=sent.length;
 const boundCallback=(data,id)=>{const update=callback(chat,data);update.callback_query.message.message_id=id;return update;};
 await handleUpdate(boundCallback(first,firstMessage));
 assert.match(sent.at(-1).text,/Сумма/);
 bindings.set(String(chat),'link:3:0');
 await handleUpdate(boundCallback(first,firstMessage));
 assert.match(sent.at(-1).text,/Кнопка устарела/);
 await handleUpdate(message(chat,'/приход'));
 const second=latestButton(chat,'paygeneral:');assert.notEqual(second,first);
 await handleUpdate(boundCallback(second,sent.length));
 assert.match(sent.at(-1).text,/Сумма/);
});


test("unlinked chats receive no reply or callback acknowledgement", async () => {
  const chat = 8842;
  unlinked.add(String(chat));
  const before = sent.length;
  const firstCall = calls.length;
  for (const text of ["/start", "/финансы", "/help", "/проекты", "Привет", "/start BadCode"]) {
    await handleUpdate(message(chat, text));
  }
  await handleUpdate(message(chat, null, { document: { file_id: "example", mime_type: "application/pdf" } }));
  await handleUpdate(callback(chat, "payout:a"));
  await handleUpdate(message(-chat, "/start", { from: { id: chat } }));
  assert.equal(sent.length, before);
  assert.deepEqual(new Set(calls.slice(firstCall).map(call => call.path)), new Set(["/api/v1/bot/session", "/api/v1/bot/link"]));
});

test("linked user without section permissions receives only the CRM denial", async () => {
  const chat = 8843;
  roles.set(String(chat), ["MANAGER"]);
  const before = sent.length;
  for (const text of ["/финансы", "/расход", "/закупка", "/повтор"]) {
    await handleUpdate(message(chat, text));
  }
  await handleUpdate(callback(chat, "payout:a"));
  assert.deepEqual(sent.slice(before).map(item => ({ text: item.text, buttons: item.reply_markup })), Array.from({ length: 5 }, () => ({
    text: deniedMessage,
    buttons: undefined,
  })));
});
