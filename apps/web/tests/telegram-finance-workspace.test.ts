import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire, Module } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  isTelegramFinancePath, readFinanceGrant, signFinanceGrant, TELEGRAM_FINANCE_COOKIE, verifiedTelegramIdentity,
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
  assert.equal(verifiedTelegramIdentity(signed(), token, now), String(user.id));
  assert.equal(verifiedTelegramIdentity(signed({}, "other-bot"), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ auth_date: String(now - 121) }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ auth_date: String(now + 16) }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ chat_type: "supergroup" }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed({ receiver: "{}" }), token, now), null);
  assert.equal(verifiedTelegramIdentity(signed() + "&user=%7B%7D", token, now), null);
  assert.equal(verifiedTelegramIdentity(signed().replace("4671246835", "4671246836"), token, now), null);
});

test("grant is tamper-evident and route scope excludes organizational and personal-plan endpoints", () => {
  const grant = { chatId: String(user.id), userId: "a1", version: 1, linkedAt: "2026-11-21T13:00:00.000Z", linkId: "tg1", expires: now + 600 };
  const cookie = signFinanceGrant(grant, secret);
  assert.deepEqual(readFinanceGrant(cookie, secret, now), grant);
  assert.equal(readFinanceGrant(cookie, secret, now + 600), null);
  assert.equal(readFinanceGrant(cookie, secret + "x", now), null);
  assert.equal(readFinanceGrant(cookie.replace(/^./, "b"), secret, now), null);
  for (const path of ["/finance", "/finance/projects/205", "/finance/advances", "/finance/payroll/export", "/api/finance/documents/upload",
    "/api/finance/documents/d1", "/api/logistics/documents/d2", "/logistics/t1", "/notifications"]) assert.equal(isTelegramFinancePath(path), true, path);
  for (const path of ["/settings", "/payroll", "/projects/205", "/warehouse", "/finance-settings", "/finance/payroll/other",
    "/api/v1/bot/payments", "/api/files/f1", "/api/logistics/documents/upload", "/api/logistics/documents/upload/x", "/plan", "/api/calendar"]) assert.equal(isTelegramFinancePath(path), false, path);
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

const dbUser = { id: "accountant-1", active: true, name: "Бухгалтер", email: "accountant@example.invalid", roles: ["ACCOUNTANT"], sessionVersion: 1 };
const dbLink = { id: "link-1", linkedAt: new Date("2026-11-21T13:00:00.000Z"), user: dbUser };
let linked = true;
let activeLink = dbLink;
let lookups = 0;
inject("../src/lib/prisma", { prisma: { telegramLink: { findUnique: async ({ where }: { where: { chatId: string } }) => {
  lookups++;
  assert.equal(where.chatId, String(user.id));
  return linked ? activeLink : null;
} } } });
inject("../src/auth", { auth: async (request?: NextRequest) => request ? Response.redirect(origin + "/login") : null });
const { POST } = require("../src/app/api/telegram/finance/session/route") as typeof import("../src/app/api/telegram/finance/session/route");
const { resolveTelegramFinanceSession } = require("../src/server/telegram/finance-session") as typeof import("../src/server/telegram/finance-session");
const { default: middleware } = require("../src/middleware") as typeof import("../src/middleware");
const request = (body: string, requestOrigin = origin) =>
  new NextRequest(origin + "/api/telegram/finance/session", { method: "POST", body, headers: { origin: requestOrigin } });
const middlewareRequest = (path: string, cookie: string, method = "GET") =>
  new NextRequest(origin + path, { method, headers: { cookie: `${TELEGRAM_FINANCE_COOKIE}=${cookie}` } });

test("entry verifies before lookup, sets only scoped cookie, and revocation is immediate", async () => {
  assert.equal((await POST(request(signed(), "https://foreign.test"))).status, 403);
  assert.equal((await POST(request(signed({}, "wrong-bot")))).status, 403);
  assert.equal(lookups, 0);
  const result = await POST(request(signed()));
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie") ?? "", /Secure.*HttpOnly.*SameSite=lax/i);
  assert.deepEqual(await result.json(), { ok: true });
  const cookie = result.cookies.get(TELEGRAM_FINANCE_COOKIE)?.value ?? "";
  assert.equal((await resolveTelegramFinanceSession(cookie))?.user.id, "accountant-1");
  const event = null as unknown as Parameters<typeof middleware>[1];
  const pass = await middleware(middlewareRequest("/finance", cookie), event);
  assert.equal(pass?.headers.get("x-middleware-next"), "1");
  const wrongArea = await middleware(middlewareRequest("/plan", cookie), event);
  assert.equal(wrongArea?.headers.get("location"), origin + "/login");
  activeLink = { ...dbLink, user: { ...dbUser, roles: ["MANAGER"] } };
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  const rejected = await middleware(middlewareRequest("/finance", cookie, "POST"), event);
  assert.equal(rejected?.status, 401);
  activeLink = { ...dbLink, user: { ...dbUser, sessionVersion: 2 } };
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  activeLink = { ...dbLink, linkedAt: new Date("2026-11-21T13:31:00.000Z") };
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  linked = false;
  assert.equal(await resolveTelegramFinanceSession(cookie), null);
  assert.equal((await POST(request(signed()))).status, 403);
});
