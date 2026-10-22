import assert from 'node:assert/strict';
import test from 'node:test';
process.env.BOT_RECOVERY_TEST='1';process.env.TELEGRAM_API_ORIGIN='http://127.0.0.1:9080';
process.env.TELEGRAM_BOT_TOKEN='fixture-token';process.env.CRM_BASE_URL='http://127.0.0.1:9081';process.env.CRM_API_TOKEN='fixture-crm-token';
const sent=[],calls=[],receipts=new Map(),roles=new Map(),uploads=new Map();
let loseAck=false,failQuote=false,loseUpload=false,updateId=1;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input));let body;
 if(options.body instanceof FormData){const file=options.body.get('file');body={clientMutationId:options.body.get('clientMutationId'),fileName:file.name,mimeType:file.type,bytes:Buffer.from(await file.arrayBuffer()).toString('hex')};}
 else body=options.body?JSON.parse(String(options.body)):undefined;
 calls.push({path:url.pathname,body,actor:options.headers?.['x-acting-user']});
 let value;
 if(url.pathname.endsWith('/sendMessage')){sent.push(body);value={ok:true,result:{message_id:sent.length,chat:{id:body.chat_id}}};}
 else if(url.pathname.endsWith('/answerCallbackQuery'))value={ok:true,result:true};
 else if(url.pathname.endsWith('/getFile'))value={ok:true,result:{file_path:'documents/file.pdf',file_size:4}};
 else if(url.pathname.startsWith('/file/'))return new Response('%PDF',{headers:{'content-length':'4'}});
 else if(url.pathname==='/api/v1/bot/documents/upload'){
  if(!uploads.has(body.clientMutationId))uploads.set(body.clientMutationId,{id:body.clientMutationId,fileName:body.fileName,mimeType:body.mimeType});
  value={ok:true,document:uploads.get(body.clientMutationId)};
  if(loseUpload){loseUpload=false;throw Error('lost upload ACK');}
 }
 else if(url.pathname==='/api/v1/bot/session'){const id=url.searchParams.get('chatId');value={found:true,user:{id:'actor-'+id,name:'Actor',roles:roles.get(id)??['PROCUREMENT'],botAllowed:true}};}
 else if(url.pathname==='/api/v1/bot/directory'){
  const type=url.searchParams.get('type');
  value={ok:true,items:type==='materials'?[{id:'material',label:'Петля',unit:'шт'}]:type==='cash'?[{id:'usd-cash',label:'USD касса',currency:'USD'}]:[{id:'article',label:'Материалы'}]};
 } else if(url.pathname==='/api/v1/bot/stock-receipts/quote'){
  if(failQuote){failQuote=false;throw Error('quote lost');}
  const rate=body.rate??3.001;
  value={ok:true,quote:{materialName:'Петля',unit:'шт',quantity:'3.000',unitPrice:'7.33',currency:'USD',amount:21.99,bynAmount:Math.round(21.99*rate*100)/100,rate,rateDate:'2026-10-08'}};
 } else if(url.pathname==='/api/v1/bot/stock-receipts'){
  assert.equal(body.materialId,'material');assert.equal(body.quantity,'3');assert.equal(body.unitPrice,'7.33');
  for(const id of body.reportDocumentIds??(body.reportDocumentId?[body.reportDocumentId]:[]))assert.ok([...uploads.values()].some(doc=>doc.id===id));assert.equal(Object.hasOwn(body,'amount'),false);
  assert.equal(Object.hasOwn(body,'projectId'),false);assert.ok(body.clientMutationId);
  if(receipts.has(body.clientMutationId))assert.deepEqual(receipts.get(body.clientMutationId),body);
  else receipts.set(body.clientMutationId,body);
  if(loseAck){loseAck=false;throw Error('lost committed ACK');}
  value={ok:true,receiptId:'receipt'};
 } else throw Error('Unexpected endpoint '+url.pathname);
 return Response.json(value);
};
const {handleUpdate}=await import('../dist/engine.js');
const msg=(id,text)=>({update_id:updateId++,message:{message_id:updateId,chat:{id},from:{id},text}});
const cb=(id,data,from=id)=>({update_id:updateId++,callback_query:{id:String(updateId),from:{id:from},message:{message_id:updateId,chat:{id}},data}});
const button=(id,match)=>sent.filter(row=>row.chat_id===id).flatMap(row=>row.reply_markup?.inline_keyboard?.flat()??[]).filter(row=>match(row.callback_data??'')).at(-1)?.callback_data;
async function begin(id,skipDocument=true){
 await handleUpdate(msg(id,'/закупка'));await handleUpdate(msg(id,'петля'));
 await handleUpdate(cb(id,button(id,value=>value.includes(':pick:'))));
 await handleUpdate(msg(id,'3'));await handleUpdate(cb(id,button(id,value=>value.includes(':pick:'))));
 await handleUpdate(msg(id,'7.33'));await handleUpdate(cb(id,button(id,value=>value.includes(':pick:'))));
 await handleUpdate(msg(id,'авто'));await handleUpdate(msg(id,'—'));
 if(skipDocument)await handleUpdate(cb(id,button(id,value=>value.endsWith(':nodoc'))));
 return button(id,value=>value.endsWith(':ok'));
}
test('paid stock quote and lost commit acknowledgement use one request without a document',async()=>{
 const id=9901,before=receipts.size,confirm=await begin(id);assert.ok(confirm);assert.ok(confirm.length<=64);
 assert.match(sent.at(-1).text,/65[,.]99/);
 loseAck=true;await handleUpdate(cb(id,confirm));await handleUpdate(cb(id,confirm));
 assert.equal(receipts.size,before+1);
 const writes=calls.filter(row=>row.path.endsWith('/stock-receipts')&&row.actor==='actor-'+id);
 assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[0].body.rate,3.001);
 assert.equal(Object.hasOwn(writes[0].body,'reportDocumentId'),false);
 await handleUpdate(cb(id,confirm));assert.equal(calls.filter(row=>row.path.endsWith('/stock-receipts')&&row.actor==='actor-'+id).length,2);
});

test('optional receipt file retries upload and commit exactly once, stale controls cannot remove it',async()=>{
 const id=9910;await begin(id,false);const skip=button(id,value=>value.endsWith(':nodoc'));
 const file={document:{file_id:'receipt',file_unique_id:'receipt',file_name:'Чек.pdf',mime_type:'application/pdf',file_size:4}};
 loseUpload=true;await handleUpdate({...msg(id,undefined),message:{...msg(id,undefined).message,...file}});
 const retry=button(id,value=>value.includes(':docretry:'));assert.ok(retry);assert.ok(retry.length<=64);
 await handleUpdate(cb(id,retry));await handleUpdate(cb(id,button(id,value=>value.endsWith(':continue'))));const confirm=button(id,value=>value.endsWith(':ok'));assert.ok(confirm);
 assert.match(sent.at(-1).text,/Чек.pdf/);await handleUpdate(cb(id,skip));
 loseAck=true;await handleUpdate(cb(id,confirm));await handleUpdate(cb(id,confirm));
 const writes=calls.filter(row=>row.path.endsWith('/stock-receipts')&&row.actor==='actor-'+id);
 assert.equal(writes.length,2);assert.equal(writes[0].body.reportDocumentIds.length,1);assert.deepEqual(writes[0].body,writes[1].body);
 const files=calls.filter(row=>row.path.endsWith('/documents/upload')&&row.actor==='actor-'+id);
 assert.equal(files.length,2);assert.deepEqual(files[0].body,files[1].body);
});

test('receipt photos, optional skip after upload error, cancellation and current role protect files',async()=>{
 const id=9911;await begin(id,false);
 await handleUpdate({...msg(id,undefined),message:{...msg(id,undefined).message,photo:[{file_id:'large',file_unique_id:'large',width:100,height:100,file_size:4}]}});
 await handleUpdate(cb(id,button(id,value=>value.endsWith(':continue'))));
 assert.ok(button(id,value=>value.endsWith(':ok')));assert.match(sent.at(-1).text,/Фото-large.jpg/);
 await handleUpdate(cb(id,'cancel'));
 const next=9912;await begin(next,false);loseUpload=true;
 const file={document:{file_id:'f',file_unique_id:'f',file_name:'f.pdf',mime_type:'application/pdf',file_size:4}};
 await handleUpdate({...msg(next,undefined),message:{...msg(next,undefined).message,...file}});
 const retry=button(next,value=>value.includes(':docretry:'));await handleUpdate(cb(next,button(next,value=>value.endsWith(':nodoc'))));
 assert.match(sent.at(-1).text,/Без документа/);await handleUpdate(cb(next,'cancel'));
 const before=calls.filter(row=>row.path.endsWith('/getFile')).length;
 await handleUpdate(cb(next,retry));await begin(next,false);roles.set(String(next),['MANAGER']);
 await handleUpdate({...msg(next,undefined),message:{...msg(next,undefined).message,...file}});
 assert.equal(calls.filter(row=>row.path.endsWith('/getFile')).length,before);
});

test('three paid receipt files remain one immutable stock/payment request after lost ACK',async()=>{
 const id=9915;await begin(id,false);
 for(let index=1;index<=3;index++)await handleUpdate({...msg(id,undefined),message:{...msg(id,undefined).message,document:{file_id:'multi-'+index,file_unique_id:'multi-'+index,file_name:`Чек-${index}.pdf`,mime_type:'application/pdf',file_size:4}}});
 assert.equal(button(id,value=>value.endsWith(':ok')),undefined);
 await handleUpdate(cb(id,button(id,value=>value.endsWith(':continue'))));
 const confirm=button(id,value=>value.endsWith(':ok'));assert.ok(confirm);assert.match(sent.at(-1).text,/Чек-1.pdf.*Чек-2.pdf.*Чек-3.pdf/);
 loseAck=true;await handleUpdate(cb(id,confirm));await handleUpdate(cb(id,confirm));
 const writes=calls.filter(row=>row.path.endsWith('/stock-receipts')&&row.actor==='actor-'+id);
 assert.equal(writes.length,2);assert.equal(writes[0].body.reportDocumentIds.length,3);assert.deepEqual(writes[0].body,writes[1].body);
});
test('quote transport failure permits retry without changing the collected input',async()=>{
 const id=9902;failQuote=true;await begin(id);
 const retry=button(id,value=>value.endsWith(':quote'));assert.ok(retry);
 await handleUpdate(cb(id,retry));assert.ok(button(id,value=>value.endsWith(':ok')));
 const quotes=calls.filter(row=>row.path.endsWith('/quote')&&row.actor==='actor-'+id);
 assert.equal(quotes.length,2);assert.deepEqual(quotes[0].body,quotes[1].body);
 await handleUpdate(cb(id,'cancel'));
});
test('old search, old dialog, revoked finance role and group callbacks cannot conduct a purchase',async()=>{
 const id=9903;await handleUpdate(msg(id,'/закупка'));await handleUpdate(msg(id,'first'));
 const old=button(id,value=>value.includes(':pick:'));
 await handleUpdate(msg(id,'second'));const current=button(id,value=>value.includes(':pick:'));assert.notEqual(current,old);
 await handleUpdate(cb(id,old));assert.match(sent.at(-1).text,/устарел/);
 await handleUpdate(cb(id,current));assert.match(sent.at(-1).text,/Количество/);
 const confirm=await begin(id),before=receipts.size;
 roles.set(String(id),['MANAGER']);await handleUpdate(cb(id,confirm));assert.equal(receipts.size,before);
 roles.set(String(id),['PROCUREMENT']);await handleUpdate(msg(id,'/закупка'));await handleUpdate(cb(id,confirm));assert.equal(receipts.size,before);
 await handleUpdate(msg(-100,'/закупка'));await handleUpdate(cb(-100,confirm,id));assert.equal(receipts.size,before);
 const own=await begin(9904);await handleUpdate(cb(9904,own,9905));assert.equal(receipts.size,before);
});
