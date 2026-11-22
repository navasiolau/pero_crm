import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire, Module } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  isTelegramFinancePath, readFinanceGrant, signFinanceGrant, TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_ONLY_HEADER, verifiedTelegramIdentity,
} from "../src/server/telegram/finance-security";

const token = "fake-stage-token";
const secret = "s".repeat(48);
const origin = "https://finance.test";
const now = Math.floor(Date.now() / 1000);
const user = { id: 4671246835, first_name: "Бухгалтер" };
function signed(fields: Record<string, string> = {}, botToken = token) {
  const query = new URLSearchParams({ auth_date: String(now), user: JSON.stringify(user), ...fields });
  query.sort();
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  query.set("hash", createHmac("sha256", key).update([...query].map(([k, v]) => `${k}=${v}`).join("\n")).digest("hex"));
  return query.toString();
}

test("Mini App accepts only current signed private Telegram identity from the configured bot", () => {
  assert.deepEqual(verifiedTelegramIdentity(signed(), token, now), { chatId: String(user.id), authenticatedAt: now * 1000 });
  assert.equal(verifiedTelegramIdentity(signed({}, "other-bot"), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ auth_date: String(now - 121) }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ auth_date: String(now + 16) }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ chat_type: "supergroup" }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ receiver: "{}" }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed() + "&user=%7B%7D", token, now), null);
  assert.equal(verifiedTelegramIdentity(signed().replace("4671246835", "4671246836"), token, now), null);
});

test("grant is tamper-evident and route scope excludes organizational and personal-plan endpoints", () => {
  const grant = { chatId: String(user.id), userId: "a1", generation: 1, version: 1, linkedAt: "2026-11-21T13:00:00.000Z", linkId: "tg1", expires: now + 600 };
  const cookie = signFinanceGrant(grant, secret);
  assert.deepEqual(readFinanceGrant(cookie, secret, now), grant);
  assert.equal(readFinanceGrant(cookie, secret, now + 600), null);
  assert.equal(readFinanceGrant(cookie, secret + "x", now), null);
  assert.equal(readFinanceGrant(cookie.replace(/^./, "b"), secret, now), null);
  for (const path of ["/finance", "/finance/projects/205", "/finance/advances", "/finance/payroll/export", "/api/finance/documents/upload",
    "/api/finance/documents/d1", "/api/logistics/documents/d2", "/logistics/t1"]) assert.equal(isTelegramFinancePath(path), true, path);
  for (const path of ["/settings", "/payroll", "/projects/205", "/warehouse", "/finance-settings", "/finance/payroll/other",
    "/api/v1/bot/payments", "/api/files/f1", "/api/logistics/documents/upload", "/api/logistics/documents/upload/x", "/plan", "/api/calendar", "/notifications"]) assert.equal(isTelegramFinancePath(path), false, path);
});

const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name);
  const replacement = new Module(file);
  replacement.filename = file;
  replacement.loaded = true;
  replacement.exports = exports;
  require.cache[file] = replacement;
}
process.env.PERO_TELEGRAM_FINANCE_ORIGIN = origin;
process.env.PERO_TELEGRAM_FINANCE_BOT_TOKEN = token;
process.env.PERO_TELEGRAM_FINANCE_SESSION_SECRET = secret;

const dbUser = { id: "accountant-1", active: true, name: "Бухгалтер", email: "accountant@example.invalid", roles: ["ACCOUNTANT"], sessionVersion: 1, updatedAt: new Date((now - 1000) * 1000) };
const dbLink = { id: "link-1", chatId: String(user.id), linkedAt: new Date((now - 1000) * 1000), revokedAt: null, generation: 1, user: dbUser };
let linked = true;
let activeLink = dbLink;
let lookups = 0;
let webAuthCalls = 0;
inject("../src/lib/prisma", { prisma: { telegramLink: { findUnique: async ({ where }: { where: { chatId: string } }) => {
  lookups++;
  assert.equal(where.chatId, String(user.id));
  return linked ? activeLink : null;
} } } });
inject("next/headers", { cookies: async () => ({ get: () => undefined }) });
inject("../src/auth", { auth: async (request?: NextRequest) => {
  webAuthCalls++;
  return request ? Response.redirect(origin + "/login") : null;
} });
const { POST } = require("../src/app/api/telegram/finance/session/route") as typeof import("../src/app/api/telegram/finance/session/route");
const { resolveTelegramFinanceSession, scopedFinanceAuth } = require("../src/server/telegram/finance-session") as typeof import("../src/server/telegram/finance-session");
const { default: middleware } = require("../src/middleware") as typeof import("../src/middleware");
const request = (body: string, requestOrigin = origin) =>
  new NextRequest(origin + "/api/telegram/finance/session", { method: "POST", body, headers: { origin: requestOrigin } });
const middlewareRequest = (path: string, cookie: string, method = "GET", telegramOnly = false) =>
  new NextRequest(origin + path, { method, headers: {
    ...(cookie ? { cookie: `${TELEGRAM_FINANCE_COOKIE}=${cookie}` } : {}),
    ...(telegramOnly ? { [TELEGRAM_FINANCE_ONLY_HEADER]: "1" } : {}),
  } });
const deniedMessage = "Вам не доступен этот раздел, если это ошибка - обратитесь к Администратору";

test("entry verifies before lookup, sets only scoped cookie, and revocation is immediate", async () => {
  assert.equal((await POST(request(signed(), "https://foreign.test"))).status, 403);
  assert.equal((await POST(request(signed({}, "wrong-bot")))).status, 403);
  assert.equal(lookups, 0);
  const result = await POST(request(signed()));
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie") ?? "", /Secure.*HttpOnly.*SameSite=lax/i);
  assert.deepEqual(await result.json(), { ok: true });
  const cookie = result.cookies.get(TELEGRAM_FINANCE_COOKIE)?.value ?? "";
  const checkedSession = await resolveTelegramFinanceSession(cookie);
  assert.equal(checkedSession?.kind === "authenticated" && checkedSession.session.user.id, "accountant-1");
  const event = null as unknown as Parameters<typeof middleware>[1];
  const pass = await middleware(middlewareRequest("/finance", cookie), event);
  assert.equal(pass?.headers.get("x-middleware-next"), "1");
  const wrongArea = await middleware(middlewareRequest("/plan", cookie), event);
  assert.equal(wrongArea?.headers.get("location"), origin + "/login");
  activeLink = { ...dbLink, user: { ...dbUser, roles: ["MANAGER"] } };
  const roleDenied = await POST(request(signed()));
  assert.equal(roleDenied.status, 403);
  assert.deepEqual(await roleDenied.json(), { ok: false, error: deniedMessage });
  assert.deepEqual(await resolveTelegramFinanceSession(cookie), { kind: "forbidden" });
  const rejected = await middleware(middlewareRequest("/finance", cookie, "POST"), event);
  assert.equal(rejected?.status, 403);
  assert.equal(await rejected?.text(), deniedMessage);
  activeLink = { ...dbLink, user: { ...dbUser, sessionVersion: 2 } };
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  activeLink = { ...dbLink, linkedAt: new Date("2026-11-21T13:31:00.000Z") };
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  activeLink = { ...dbLink, generation: 2 };
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  activeLink = { ...dbLink, generation: 3, linkedAt: new Date(now * 1000 + 1) };
  assert.equal((await POST(request(signed()))).status, 403);
  linked = false;
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  const unbound = await POST(request(signed()));
  assert.equal(unbound.status, 409);
  assert.deepEqual(await unbound.json(), {
    ok: false, code: "LINK_REQUIRED", error: "Привяжите Telegram в профиле CRM через «Telegram → Получить ссылку».",
  });
  assert.equal(unbound.headers.get("set-cookie"), null);
});

test("the staging Mini App origin requires Telegram authentication for pages, actions and files", async () => {
  linked = true;
  activeLink = { ...dbLink, user: { ...dbUser, roles: ["PROCUREMENT"] } };
  const result = await POST(request(signed()));
  const cookie = result.cookies.get(TELEGRAM_FINANCE_COOKIE)?.value ?? "";
  assert.ok(cookie);
  const event = null as unknown as Parameters<typeof middleware>[1];
  const before = webAuthCalls;
  const page = await middleware(middlewareRequest("/finance", "", "GET", true), event);
  assert.equal(page?.headers.get("location"), origin + "/telegram/finance");
  for (const [path, method] of [["/api/finance/documents/d1", "GET"], ["/finance/expenses", "POST"]]) {
    const response = await middleware(middlewareRequest(path, "", method, true), event);
    assert.equal(response?.status, 401);
  }
  for (const path of ["/finance/payroll", "/finance/payroll/export", "/finance/unknown", "/notifications"]) {
    const response = await middleware(middlewareRequest(path, cookie, "GET", true), event);
    assert.equal(response?.status, 403);
    assert.equal(await response?.text(), deniedMessage);
  }
  assert.equal((await middleware(middlewareRequest("/finance/accounts", cookie, "GET", true), event))?.headers.get("x-middleware-next"), "1");
  assert.equal(await scopedFinanceAuth(true), null);
  assert.equal(webAuthCalls, before);
  assert.equal((await middleware(middlewareRequest("/finance", ""), event))?.headers.get("location"), origin + "/login");
});
