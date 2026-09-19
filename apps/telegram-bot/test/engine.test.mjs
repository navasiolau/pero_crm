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
      : type === "cash" ? { ok: true, items: [{ id: "cash-1", label: "Main", currency: "BYN" }] }
      : { ok: true, items: [] };
  } else if (url.pathname === "/api/v1/bot/projects" && options.method === "GET") {
    value = { ok: true, projects: [{ id: "project-205", number: "205", title: "Existing", stage: "NEW", currency: "BYN" }] };
  } else if (url.pathname === "/api/v1/bot/projects" && options.method === "POST") {
    value = { ok: true, number: "999" };
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
    callback(7, 501, "npc:BYN"),
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
    title: "Восстановленный заказ", clientId: "client-1", currency: "BYN",
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
