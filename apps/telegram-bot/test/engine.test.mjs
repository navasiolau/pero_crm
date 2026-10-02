import assert from "node:assert/strict";
import test from "node:test";

process.env.BOT_RECOVERY_TEST = "1";
process.env.TELEGRAM_API_ORIGIN = "http://127.0.0.1:9080";
process.env.TELEGRAM_BOT_TOKEN = "fixture-token";
process.env.CRM_BASE_URL = "http://192.168.10.20";
process.env.CRM_API_TOKEN = "fixture-crm-token";

const calls = [];
const sent = [];
let nextMessageId = 1000;
let stageFailure=false;let loseStageAck=false;
let editFixture=false,loseEditAck=false,editConflict=false,editWrites=0;const editReceipts=new Map();
const baseline={title:"Captured title",clientId:"client-1",managerId:null,address:"Captured address",currency:"BYN",initialPrice:null,delivery:null,unloading:null,installation:null};

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const body = options.body ? JSON.parse(String(options.body)) : undefined;
  calls.push({
    method: options.method,
    path: url.pathname,
    query: url.searchParams,
    body,
    actor: options.headers?.["x-acting-user"],
    authorization: options.headers?.authorization,
  });
  let value;
  if (url.pathname.endsWith("/sendMessage")) {
    sent.push(body);
    value = { ok: true, result: { message_id: nextMessageId++, chat: { id: body.chat_id }, text: body.text } };
  } else if (url.pathname.endsWith("/answerCallbackQuery")) {
    value = { ok: true, result: true };
  } else if (url.pathname === "/api/v1/bot/link") {
    value = { ok: true, user: { name: "Linked", roles: ["WORKER"], botAllowed: false } };
  } else if (url.pathname === "/api/v1/bot/session") {
    value = url.searchParams.get("chatId") === "502"
      ? { ok: true, found: true, user: { id: "worker-1", name: "Worker", roles: ["WORKER"], botAllowed: false } }
      : { ok: true, found: true, user: { id: "admin-1", name: "Admin", roles: ["ADMIN"], botAllowed: true } };
  } else if (url.pathname === "/api/v1/bot/directory") {
    const type = url.searchParams.get("type");
    value = type === "clients" ? { ok: true, items: [{ id: "client-1", label: "Client" }] }
      : type === "managers" ? { ok: true, items: [{ id: "manager-1", label: "Manager" }] }
      : type === "cash" ? { ok: true, items: [{ id: "cash-1", label: "Main", currency: "BYN" }, { id: "cash-usd", label: "USD cash", currency: "USD" }] }
      : { ok: true, items: [] };
  } else if (url.pathname === "/api/v1/bot/projects" && options.method === "GET") {
    value = { ok: true, projects: [{ id: "project-205", number: "205", title: "Existing", stage: "NEW", currency: "BYN" }] };
  } else if (url.pathname === "/api/v1/bot/projects" && options.method === "POST") {
    value = { ok: true, number: "999" };
  } else if (url.pathname === "/api/v1/bot/projects/205" && options.method === "GET") {
    value = { project: { id: "205", number: "205", stage:"LEAD",address: "Captured address",fullBaseline:baseline } };
  } else if (url.pathname === "/api/v1/bot/projects/205/stage") {
    if(loseStageAck){loseStageAck=false;throw Error("lost ACK")}
    value={ok:!stageFailure,error:stageFailure?"conflict":undefined};
  } else if (url.pathname === "/api/v1/bot/projects/205" && options.method === "PATCH") {
    if(editFixture){if(editConflict)value={ok:false,kind:"conflict",error:"Conflict"};else {if(!body.clientMutationId||!editReceipts.has(body.clientMutationId)){editWrites++;if(body.clientMutationId)editReceipts.set(body.clientMutationId,body)}value={ok:true,kind:"saved",replayed:editReceipts.has(body.clientMutationId)};}
      if(loseEditAck){loseEditAck=false;throw Error("lost ACK after commit");}}
    else value = { ok: true };
  } else if (url.pathname === "/api/v1/bot/payments") {
    value = { ok: true };
  } else {
    throw new Error(`unexpected fake request ${options.method} ${url.pathname}`);
  }
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
};

const { handleUpdate } = await import("../dist/engine.js");

function message(updateId, chatId, text) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: chatId }, from: { id: chatId }, text } };
}

function callback(updateId, chatId, data) {
  return { update_id: updateId, callback_query: {
    id: `callback-${updateId}`, from: { id: chatId },
    message: { message_id: updateId, chat: { id: chatId } }, data,
  } };
}

test("engine executes restored link, role, project and payment behavior", async () => {
  const updates = [
    message(1, 503, "/start LINKCODE"),
    message(2, 502, "/help"),
    message(3, 501, "/новый"),
    message(4, 501, "Восстановленный заказ"),
    message(5, 501, "Клиент"),
    callback(6, 501, "cli:client-1"),
    callback(8, 501, "mgr:manager-1"),
    message(9, 501, "1500"),
    message(10, 501, "/приход 205 100"),
    callback(11, 501, "cur:BYN"),
    callback(12, 501, "cash:cash-1"),
    message(13, 501, "—"),
    callback(14, 501, "payok"),
  ];
  for (const update of updates) await handleUpdate(update);

  assert.ok(sent.some((item) => item.chat_id === 503 && item.text.toLowerCase().includes("привяз")));
  assert.ok(sent.some((item) => item.chat_id === 502 && item.text.includes("доступен только")));
  const project = calls.find((item) => item.path === "/api/v1/bot/projects" && item.method === "POST");
  assert.ok(project, `project call missing: ${JSON.stringify({ calls, sent })}`);
  assert.deepEqual(project.body, {
    title: "Восстановленный заказ", clientId: "client-1",
    managerId: "manager-1", initialPrice: 1500,
  });
  const payment = calls.find((item) => item.path === "/api/v1/bot/payments");
  assert.ok(payment, `payment call missing: ${JSON.stringify({ calls, sent })}`);
  assert.deepEqual(payment.body, {
    projectId: "project-205", direction: "INCOME", amount: 100,
    currency: "BYN", cashAccountId: "cash-1",
  });
  assert.ok(calls.filter((item) => item.path.startsWith("/api/v1/bot/")).every(
    (item) => item.authorization === "Bearer fixture-crm-token",
  ));
  assert.equal(project.actor, "admin-1");
  assert.equal(payment.actor, "admin-1");
});


test("project wizard skips currency and rejects stale foreign currency callback", async () => {
  const startCalls = calls.length;
  const startSent = sent.length;
  await handleUpdate(message(101, 601, "/новый"));
  await handleUpdate(message(102, 601, "Заказ BYN"));
  await handleUpdate(message(103, 601, "Клиент"));
  await handleUpdate(callback(104, 601, "cli:client-1"));
  const managerPrompt = sent.at(-1);
  assert.ok(managerPrompt.text.includes("Менеджер проекта"));
  assert.ok(!JSON.stringify(sent.slice(startSent)).includes("npc:"));
  await handleUpdate(callback(105, 601, "npc:RUB"));
  assert.ok(sent.at(-1).text.includes("BYN"));
  await handleUpdate(callback(106, 601, "mgr:none"));
  await handleUpdate(message(107, 601, "—"));
  assert.equal(calls.slice(startCalls).filter(item => item.path === "/api/v1/bot/projects" && item.method === "POST").length, 0);
});


test("physical payment currency remains selectable independently of project BYN", async () => {
  const startCalls = calls.length;
  await handleUpdate(message(201, 701, "/приход 205 100"));
  assert.ok(JSON.stringify(sent.at(-1)).includes("cur:USD"));
  await handleUpdate(callback(202, 701, "cur:USD"));
  await handleUpdate(callback(203, 701, "cash:cash-usd"));
  await handleUpdate(message(204, 701, "—"));
  await handleUpdate(callback(205, 701, "payok"));
  const payment = calls.slice(startCalls).find(item => item.path === "/api/v1/bot/payments");
  assert.equal(payment.body.currency, "USD");
  assert.equal(payment.body.amount, 100);
  assert.equal(payment.body.cashAccountId, "cash-usd");
});

test("address edit PATCH carries the genuine address captured when dialog opened", async () => {
  const before = calls.length;
  await handleUpdate(callback(5101, 501, "ed:205:address"));
  await handleUpdate(message(5102, 501, "Changed address"));
  const patch = calls.slice(before).find(call => call.method === "PATCH" && call.path === "/api/v1/bot/projects/205");
  assert.ok(patch); assert.equal(patch.body.field,"address");assert.equal(patch.body.value,"Changed address");assert.equal(patch.body.expectedValue,baseline.address);assert.match(patch.body.clientMutationId,/^[a-f0-9-]{36}$/);
});


test("title and manager edits retain full genuine baseline",async()=>{
 const before=calls.length;await handleUpdate(callback(5201,801,"ed:205:title"));await handleUpdate(message(5202,801,"Edited"));
 await handleUpdate(callback(5203,801,"ed:205:manager"));await handleUpdate(callback(5204,801,"mgr:manager-1"));
 const writes=calls.slice(before).filter(call=>call.method==='PATCH');assert.equal(writes.length,2);assert.equal(writes[0].body.field,'title');assert.equal(writes[0].body.value,'Edited');assert.equal(writes[0].body.expectedValue,baseline.title);assert.equal(writes[1].body.field,'managerId');assert.equal(writes[1].body.value,'manager-1');assert.equal(writes[1].body.expectedValue,baseline.managerId);
});
function stageButton(stage){return sent.at(-1).reply_markup.inline_keyboard.flat().find(item=>item.callback_data.includes(`:${stage}:`)).callback_data;}
test("stage menu captures baseline once, stale callback rejected, refusal optional comment and lost ACK retry same UUID",async()=>{
 const before=calls.length;
 await handleUpdate(callback(5300,901,'st:205:IN_WORK'));assert.equal(calls.slice(before).filter(c=>c.path.endsWith('/stage')).length,0);
 await handleUpdate(callback(5301,901,'stage:205'));const chosen=stageButton('REFUSED');
 await handleUpdate(callback(5302,901,chosen));await handleUpdate(message(5303,901,'дорого'));loseStageAck=true;
 await handleUpdate(message(5304,901,'—'));await handleUpdate(message(5305,901,'—'));
 const stageWrites=calls.slice(before).filter(c=>c.path.endsWith('/stage'));assert.equal(stageWrites.length,2);assert.deepEqual(stageWrites[0].body,stageWrites[1].body);assert.equal(stageWrites[0].body.expectedStage,'LEAD');assert.equal(stageWrites[0].body.extras.refusalComment,'');assert.match(stageWrites[0].body.clientMutationId,/^[a-f0-9-]{36}$/);
 assert.equal(calls.slice(before).filter(c=>c.path==='/api/v1/bot/projects/205'&&c.method==='GET').length,1);
 await handleUpdate(callback(5306,901,'stage:205'));await handleUpdate(callback(5307,901,chosen));assert.equal(calls.slice(before).filter(c=>c.path.endsWith('/stage')).length,2);
});
test("reclamation dialog retains extras after conflict and requires all details",async()=>{
 const before=calls.length;await handleUpdate(callback(5401,902,'stage:205'));await handleUpdate(callback(5402,902,stageButton('RECLAMATION')));
 await handleUpdate(message(5403,902,'скол'));await handleUpdate(message(5404,902,'фасад'));stageFailure=true;
 await handleUpdate(message(5405,902,'цех'));stageFailure=false;await handleUpdate(message(5406,902,'цех'));
 const writes=calls.slice(before).filter(c=>c.path.endsWith('/stage'));assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.deepEqual(writes[0].body.extras,{reclamationReason:'скол',reclamationDescription:'фасад',reclamationFault:'цех'});
});


test("ordinary project edits retry same field receipt after commit then lost ACK",async()=>{
 editFixture=true;
 for(const [field,value,chat] of [['title','Lost title',951],['address','Lost address',952],['manager','manager-1',953]]){
  const before=calls.length;const initialWrites=editWrites;
  await handleUpdate(callback(5500,chat,`ed:205:${field}`));loseEditAck=true;
  const send=async(id)=>field==='manager'?handleUpdate(callback(id,chat,`mgr:${value}`)):handleUpdate(message(id,chat,value));
  await send(5501);await send(5502);
  const writes=calls.slice(before).filter(c=>c.method==='PATCH');assert.equal(writes.length,2);assert.match(writes[0].body.clientMutationId,/^[a-f0-9-]{36}$/);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(editWrites-initialWrites,1);assert.equal(writes[0].body.expectedValue,baseline[field==='manager'?'managerId':field]);
  assert.equal(calls.slice(before).filter(c=>c.method==='GET'&&c.path==='/api/v1/bot/projects/205').length,1);
 }
 editFixture=false;
});


test("intentional new edit value gets a new UUID without silently replacing baseline",async()=>{
 editFixture=true;const before=calls.length;
 await handleUpdate(callback(5600,954,'ed:205:title'));loseEditAck=true;await handleUpdate(message(5601,954,'First intended'));await handleUpdate(message(5602,954,'Second intended'));
 const writes=calls.slice(before).filter(c=>c.method==='PATCH');assert.equal(writes.length,2);assert.notEqual(writes[0].body.clientMutationId,writes[1].body.clientMutationId);assert.equal(writes[1].body.expectedValue,baseline.title);assert.equal(writes[1].body.value,'Second intended');assert.equal(calls.slice(before).filter(c=>c.method==='GET'&&c.path==='/api/v1/bot/projects/205').length,1);editFixture=false;
});
test("edit conflict retains the dialog and asks to reopen instead of inventing a fresh baseline",async()=>{
 editFixture=true;editConflict=true;const before=calls.length;
 await handleUpdate(callback(5700,955,'ed:205:address'));await handleUpdate(message(5701,955,'Draft address'));assert.match(sent.at(-1).text,/Откройте редактирование заново/);
 await handleUpdate(message(5702,955,'Revised draft'));const writes=calls.slice(before).filter(c=>c.method==='PATCH');assert.equal(writes.length,2);assert.equal(writes[1].body.expectedValue,baseline.address);assert.equal(calls.slice(before).filter(c=>c.method==='GET'&&c.path==='/api/v1/bot/projects/205').length,1);editFixture=false;editConflict=false;
});
