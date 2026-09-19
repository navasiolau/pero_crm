import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

async function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for bot recovery flow");
}

function update(id, chatId, text) {
  return {
    update_id: id,
    message: { message_id: id, chat: { id: chatId }, from: { id: chatId }, text },
  };
}

function callback(id, chatId, data) {
  return {
    update_id: id,
    callback_query: {
      id: `callback-${id}`,
      from: { id: chatId },
      message: { message_id: id, chat: { id: chatId } },
      data,
    },
  };
}

test("long polling drives link, role gate, project and payment through fake HTTP APIs", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "pero-bot-recovery-"));
  const healthFile = join(temp, "health.json");
  const calls = [];
  const sent = [];
  let delivered = false;
  let messageId = 1000;
  const updates = [
    update(1, 303, "/start LINKCODE"),
    update(2, 202, "/help"),
    update(3, 101, "/новый"),
    update(4, 101, "Восстановленный заказ"),
    update(5, 101, "Тестовый клиент"),
    callback(6, 101, "cli:client-1"),
    callback(7, 101, "npc:BYN"),
    callback(8, 101, "mgr:manager-1"),
    update(9, 101, "1500"),
    update(10, 101, "/приход 205 100"),
    callback(11, 101, "cur:BYN"),
    callback(12, 101, "cash:cash-1"),
    update(13, 101, "—"),
    callback(14, 101, "payok"),
  ];

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    const url = new URL(request.url, "http://fixture");
    calls.push({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body,
      actor: request.headers["x-acting-user"],
      authorization: request.headers.authorization,
    });

    let payload;
    if (url.pathname.endsWith("/getMe")) payload = { ok: true, result: { id: 1, is_bot: true, username: "recovery_fixture_bot" } };
    else if (url.pathname.endsWith("/getUpdates")) {
      payload = { ok: true, result: delivered ? [] : updates };
      delivered = true;
    } else if (url.pathname.endsWith("/sendMessage")) {
      sent.push(body);
      payload = { ok: true, result: { message_id: messageId++, chat: { id: body.chat_id }, text: body.text } };
    } else if (url.pathname.endsWith("/answerCallbackQuery")) payload = { ok: true, result: true };
    else if (url.pathname === "/api/v1") payload = { service: "PERO CRM", api: "v1", plugins: [] };
    else if (url.pathname === "/api/v1/bot/register") payload = { ok: true };
    else if (url.pathname === "/api/v1/bot/link") payload = { ok: true, user: { name: "Linked User", roles: ["WORKER"], botAllowed: false } };
    else if (url.pathname === "/api/v1/bot/session") {
      const chatId = url.searchParams.get("chatId");
      payload = chatId === "202"
        ? { ok: true, found: true, user: { id: "worker-1", name: "Worker", roles: ["WORKER"], botAllowed: false } }
        : { ok: true, found: true, user: { id: "manager-1", name: "Manager", roles: ["ADMIN"], botAllowed: true } };
    } else if (url.pathname === "/api/v1/bot/projects" && request.method === "GET") {
      payload = { ok: true, projects: [{ id: "project-205", number: "205", title: "Project", stage: "NEW", currency: "BYN" }] };
    } else if (url.pathname === "/api/v1/bot/projects" && request.method === "POST") payload = { ok: true, number: "999" };
    else if (url.pathname === "/api/v1/bot/payments") payload = { ok: true };
    else if (url.pathname === "/api/v1/bot/directory") {
      const type = url.searchParams.get("type");
      payload = type === "clients" ? { ok: true, items: [{ id: "client-1", label: "Test Client" }] }
        : type === "managers" ? { ok: true, items: [{ id: "manager-1", label: "Manager" }] }
        : type === "cash" ? { ok: true, items: [{ id: "cash-1", label: "Main", currency: "BYN" }] }
        : { ok: true, items: [] };
    } else payload = { ok: false, error: `unhandled fixture route ${request.method} ${url.pathname}` };
    const send = () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (url.pathname.endsWith("/getUpdates") && delivered && payload.result.length === 0) {
      setTimeout(send, 20);
    } else {
      send();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      BOT_RECOVERY_TEST: "1",
      TELEGRAM_API_ORIGIN: origin,
      TELEGRAM_BOT_TOKEN: "fixture-token",
      CRM_BASE_URL: origin,
      CRM_API_TOKEN: "fixture-crm-token",
      BOT_HEALTH_FILE: healthFile,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });

  await waitFor(() => calls.some((call) => call.path === "/api/v1/bot/payments"));
  const evidence = await waitFor(async () => {
    try {
      const current = JSON.parse(await readFile(healthFile, "utf8"));
      return current.status === "healthy" ? current : null;
    } catch {
      return null;
    }
  });

  assert.doesNotMatch(stderr, /\[bot\] (?:фатальная ошибка|ошибка polling|ошибка обработки)/);
  assert.equal(evidence.polling.failureReason, null);
  assert.ok(Date.parse(evidence.polling.lastSuccessAt));
  assert.ok(Date.parse(evidence.crm.lastSuccessAt));
  assert.ok(calls.some((call) => call.path === "/api/v1" && call.method === "GET"));
  assert.ok(calls.some((call) => call.path === "/api/v1/bot/link" && call.body.code === "LINKCODE"));
  assert.ok(sent.some((message) => message.chat_id === 202 && message.text.includes("доступен только")));

  const project = calls.find((call) => call.path === "/api/v1/bot/projects" && call.method === "POST");
  assert.deepEqual(project.body, { title: "Восстановленный заказ", clientId: "client-1", currency: "BYN", managerId: "manager-1", initialPrice: 1500 });
  assert.equal(project.actor, "manager-1");
  const payment = calls.find((call) => call.path === "/api/v1/bot/payments");
  assert.deepEqual(payment.body, { projectId: "project-205", direction: "INCOME", amount: 100, currency: "BYN", cashAccountId: "cash-1" });
  assert.equal(payment.actor, "manager-1");
  assert.ok(calls.filter((call) => call.path.startsWith("/botfixture-token/")).length > 0);
  assert.ok(
    calls
      .filter((call) => call.path.startsWith("/api/v1"))
      .every((call) => call.authorization === "Bearer fixture-crm-token"),
  );
  assert.ok(calls.every((call) => !JSON.stringify(call).includes("api.telegram.org")));
});
