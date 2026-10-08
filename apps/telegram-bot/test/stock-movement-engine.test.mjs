import assert from 'node:assert/strict';
import test from 'node:test';
process.env.BOT_RECOVERY_TEST='1';process.env.TELEGRAM_API_ORIGIN='http://127.0.0.1:9080';
process.env.TELEGRAM_BOT_TOKEN='fixture-token';process.env.CRM_BASE_URL='http://127.0.0.1:9081';process.env.CRM_API_TOKEN='fixture-crm-token';
const sent=[],calls=[],receipts=new Map(),roles=new Map();let updateId=1,loseAck=false,legacy=false;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input)),body=options.body?JSON.parse(String(options.body)):undefined,actor=options.headers?.['x-acting-user'];
 calls.push({path:url.pathname,body,actor});let value;
 if(url.pathname.endsWith('/sendMessage')){sent.push(body);value={ok:true,result:{message_id:sent.length,chat:{id:body.chat_id}}};}
 else if(url.pathname.endsWith('/answerCallbackQuery'))value={ok:true,result:true};
 else if(url.pathname==='/api/v1/bot/session'){const id=url.searchParams.get('chatId');value={found:true,user:{id:'actor-'+id,name:'Actor',roles:roles.get(id)??['PROCUREMENT'],botAllowed:true}};}
 else if(url.pathname==='/api/v1/bot/stock-movements'&&options.method==='GET'){
  const kind=url.searchParams.get('kind'),canMoney=!(roles.get(actor?.slice(6))??[]).includes('MANAGER');
  value={ok:true,items:kind==='products'?[{id:'product',label:'205.1'}]:kind==='materials'?[{id:'material',label:'Петля',unit:'шт',available:5}]
   :legacy?[{id:'legacy:line',label:'Петля · до нового учёта',legacyLineId:'line',unit:'шт',available:3,unitPrice:null}]:[{id:'issue-source',label:'Петля · 2026-10-08',unit:'шт',available:3,unitPrice:canMoney?'20':null}]};
 }else if(url.pathname==='/api/v1/bot/stock-movements'){
  if(!receipts.has(body.clientMutationId))receipts.set(body.clientMutationId,body);else assert.deepEqual(receipts.get(body.clientMutationId),body);
  if(loseAck){loseAck=false;throw Error('lost committed acknowledgement');}
  value={ok:true,movementId:'movement'};
 }else throw Error('Unexpected endpoint '+url.pathname);
 return Response.json(value);
};
const {handleUpdate}=await import('../dist/engine.js');
const msg=(id,text)=>({update_id:updateId++,message:{message_id:updateId,chat:{id},from:{id},text}});
const cb=(id,data,from=id)=>({update_id:updateId++,callback_query:{id:String(updateId),from:{id:from},message:{message_id:updateId,chat:{id}},data}});
const button=(id,part)=>sent.filter(row=>row.chat_id===id).flatMap(row=>row.reply_markup?.inline_keyboard?.flat()??[]).filter(row=>row.callback_data?.includes(part)).at(-1)?.callback_data;
async function product(id,command){await handleUpdate(msg(id,command));await handleUpdate(msg(id,'205.1'));await handleUpdate(cb(id,button(id,':pick:')));}
async function issue(id){
 await product(id,'/выдача');await handleUpdate(msg(id,'Петля'));await handleUpdate(cb(id,button(id,':pick:')));
 await handleUpdate(msg(id,'3'));await handleUpdate(msg(id,'—'));return button(id,':ok');
}
test('direct issue sends product/material without need or price; lost ACK retries one warehouse operation',async()=>{
 const id=9911,confirm=await issue(id),before=receipts.size;assert.ok(confirm&&confirm.length<=64);
 loseAck=true;await handleUpdate(cb(id,confirm));await handleUpdate(cb(id,confirm));
 assert.equal(receipts.size,before+1);
 const requests=calls.filter(row=>row.actor==='actor-'+id&&row.body?.kind==='EXPENSE');
 assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);
 assert.equal(requests[0].body.productId,'product');assert.equal(requests[0].body.materialId,'material');
 assert.equal(requests[0].body.projectMaterialId,undefined);assert.equal(requests[0].body.unitPrice,undefined);
 await handleUpdate(cb(id,confirm));assert.equal(receipts.size,before+1);
});
test('return uses saved issue; legacy return alone requests an explicit valuation',async()=>{
 for(const [id,isLegacy] of [[9912,false],[9913,true]]){
  legacy=isLegacy;await product(id,'/возврат');await handleUpdate(cb(id,button(id,':pick:')));
  await handleUpdate(msg(id,'1'));if(isLegacy)await handleUpdate(msg(id,'7.5'));
  await handleUpdate(msg(id,'—'));await handleUpdate(cb(id,button(id,':ok')));
  const body=calls.filter(row=>row.actor==='actor-'+id&&row.body?.kind==='RETURN').at(-1).body;
  if(isLegacy){assert.equal(body.projectMaterialId,'line');assert.equal(body.unitPrice,'7.5');assert.equal(body.sourceMovementId,undefined);}
  else{assert.equal(body.productId,'product');assert.equal(body.sourceMovementId,'issue-source');assert.equal(body.unitPrice,undefined);}
 }legacy=false;
});
test('inventory uses its existing no-cash contract and warehouse manager does not receive a source price',async()=>{
 const id=9914;roles.set(String(id),['MANAGER']);await handleUpdate(msg(id,'/инвприход'));
 await handleUpdate(msg(id,'Петля'));await handleUpdate(cb(id,button(id,':pick:')));await handleUpdate(msg(id,'3'));await handleUpdate(msg(id,'20'));await handleUpdate(msg(id,'—'));
 assert.match(sent.at(-1).text,/Деньги из кассы не списываются/);await handleUpdate(cb(id,button(id,':ok')));
 const body=calls.filter(row=>row.actor==='actor-'+id&&row.body?.kind==='INCOME').at(-1).body;
 assert.equal(body.receiptKind,'INVENTORY');assert.equal(body.cashAccountId,undefined);assert.equal(body.projectId,undefined);
 await product(id,'/возврат');await handleUpdate(cb(id,button(id,':pick:')));await handleUpdate(msg(id,'1'));await handleUpdate(msg(id,'—'));
 assert.ok(!sent.at(-1).text.includes('Цена исходной'));await handleUpdate(cb(id,'cancel'));
});
test('stale search, role revocation, group and foreign callbacks never create stock movements',async()=>{
 const id=9915;await product(id,'/выдача');await handleUpdate(msg(id,'old'));const old=button(id,':pick:');
 await handleUpdate(msg(id,'new'));await handleUpdate(cb(id,old));assert.match(sent.at(-1).text,/устарел/);
 const confirm=await issue(id),before=receipts.size;roles.set(String(id),['WORKER']);await handleUpdate(cb(id,confirm));assert.equal(receipts.size,before);
 roles.set(String(id),['PROCUREMENT']);await handleUpdate(msg(id,'/выдача'));await handleUpdate(cb(id,confirm));assert.equal(receipts.size,before);
 await handleUpdate(msg(-100,'/выдача'));await handleUpdate(cb(-100,confirm,id));assert.equal(receipts.size,before);
 const own=await issue(9916);await handleUpdate(cb(9916,own,9917));assert.equal(receipts.size,before);
});
