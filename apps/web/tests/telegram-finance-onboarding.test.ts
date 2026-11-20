import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire, Module } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server";
import type { TelegramFinanceBinding, TelegramLink } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { TELEGRAM_FINANCE_COOKIE } from "../src/server/telegram/finance-security";

const token = "fixture-telegram-bot";
const origin = "https://finance.test";
process.env.PERO_TELEGRAM_FINANCE_ORIGIN = origin;
process.env.PERO_TELEGRAM_FINANCE_BOT_TOKEN = token;
process.env.PERO_TELEGRAM_FINANCE_SESSION_SECRET = "fixture-session-key".repeat(3);
const password = "fixture-password-123";

const user = { id: "fixture-finance", name: "Тестовый бухгалтер", email: "finance@example.invalid", roles: ["ACCOUNTANT"], active: true,
  sessionVersion: 1, passwordHash: "", updatedAt: new Date(Date.now() - 60000) };
const pendings = new Map<string, TelegramFinanceBinding>();
let link: TelegramLink | null = null;
let audits = 0;
const prisma = {
  $queryRaw: async () => [],
  telegramLink: {
    findUnique: async ({ where }: { where: { chatId?: string; userId?: string } }) =>
      link && (where.chatId === link.chatId || where.userId === link.userId) ? { ...link, user } : null,
    create: async ({ data }: { data: Partial<TelegramLink> }) => {
      link = { ...data, id: "fixture-link" } as TelegramLink;
      return link;
    },
    update: async ({ data }: { data: Partial<TelegramLink> }) => {
      link = { ...link, ...data, generation: link!.generation + 1 } as TelegramLink;
      return link;
    },
  },
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      where.id === user.id || where.email === user.email ? user : null,
  },
  telegramFinanceBinding: {
    createMany: async ({ data }: { data: Pick<TelegramFinanceBinding, "id" | "launchHash" | "chatId" | "expiresAt"> }) => {
      if ([...pendings.values()].some(value => value.launchHash === data.launchHash)) return { count: 0 };
      pendings.set(data.id, { userId: null, sessionVersion: null, linkGeneration: null, linkId: null, consumedAt: null, attempts: 0, createdAt: new Date(), ...data });
      return { count: 1 };
    },
    findUnique: async ({ where }: { where: { id?: string; launchHash?: string } }) =>
      [...pendings.values()].find(value => value.id === where.id || value.launchHash === where.launchHash) ?? null,
    updateMany: async ({ where, data }: { where: { id: string }; data: Partial<TelegramFinanceBinding> }) => {
      const row = pendings.get(where.id);
      if (!row || row.userId || row.consumedAt || row.expiresAt <= new Date() || row.attempts >= 5) return { count: 0 };
      if (data.attempts) row.attempts++; else Object.assign(row, data);
      return { count: 1 };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<TelegramFinanceBinding> }) => Object.assign(pendings.get(where.id)!, data),
    aggregate: async () => ({ _sum: { attempts: 0 } }),
  },
  changeLog: { create: async () => { audits++; } },
  $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(prisma),
};
const require = createRequire(import.meta.url);
function inject(name: string, value: unknown) {
  const file = require.resolve(name), module = new Module(file);
  module.filename = file; module.loaded = true; module.exports = value; require.cache[file] = module;
}
inject("../src/lib/prisma", { prisma });
inject("../src/auth", { auth: async () => null });
const { POST: open } = require("../src/app/api/telegram/finance/session/route") as typeof import("../src/app/api/telegram/finance/session/route");
const { POST: bind } = require("../src/app/api/telegram/finance/binding/route") as typeof import("../src/app/api/telegram/finance/binding/route");
const { resolveTelegramFinanceSession } = require("../src/server/telegram/finance-session") as typeof import("../src/server/telegram/finance-session");
const { TELEGRAM_BINDING_COOKIE } = require("../src/server/telegram/finance-binding") as typeof import("../src/server/telegram/finance-binding");

function signed(chatId: number, date = Math.floor(Date.now() / 1000), extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ auth_date: String(date), user: JSON.stringify({ id: chatId }), ...extra });
  query.sort();
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  query.set("hash", createHmac("sha256", key).update([...query].map(([k, v]) => `${k}=${v}`).join("\n")).digest("hex"));
  return query.toString();
}
const request = (body: string, cookie?: string, source = origin) =>
  new NextRequest(origin + "/api/telegram/finance/binding", { method: "POST", body, headers: { origin: source,
    ...(cookie ? { cookie: `${TELEGRAM_BINDING_COOKIE}=${cookie}` } : {}) } });
const account = (secret = password) => JSON.stringify({ step: "account", email: user.email, password: secret });
const confirm = JSON.stringify({ step: "confirm" });

test("unbound Telegram verifies both identities, requires confirmation and refuses replay or takeover", async () => {
  user.passwordHash = await hashPassword(password);
  assert.equal((await open(request(signed(4234422, 1)))).status, 403);
  assert.equal((await open(request(signed(4234422, undefined, { chat_type: "group" })))).status, 403);
  assert.equal(pendings.size, 0);
  const fresh = signed(4234422);
  const first = await open(request(fresh));
  assert.equal(first.status, 409);
  assert.equal(first.cookies.get(TELEGRAM_FINANCE_COOKIE), undefined);
  const cookie = first.cookies.get(TELEGRAM_BINDING_COOKIE)?.value; assert.ok(cookie);
  assert.match(first.headers.get("set-cookie") ?? "", /Secure.*HttpOnly.*SameSite=lax/i);
  assert.equal((await open(request(fresh))).status, 403);
  assert.equal((await bind(request(confirm, cookie))).status, 409);
  assert.equal((await bind(request(account(), cookie, "https://foreign.test"))).status, 403);
  assert.equal((await bind(request(account("wrong"), cookie))).status, 403);
  user.roles = ["MANAGER"];
  assert.equal((await bind(request(account(), cookie))).status, 403);
  user.roles = ["ACCOUNTANT"];
  const proved = await bind(request(account(), cookie)); assert.equal(proved.status, 200);
  assert.equal(link, null);
  assert.deepEqual(await proved.json(), { ok: true, name: user.name });
  const stillPending = await open(request(fresh, cookie));
  assert.deepEqual(await stillPending.json(), { ok: false, code: "LINK_REQUIRED", candidate: user.name });
  const committed = await bind(request(confirm, cookie)); assert.equal(committed.status, 200);
  const grant = committed.cookies.get(TELEGRAM_FINANCE_COOKIE)?.value;
  assert.equal((await resolveTelegramFinanceSession(grant))?.user.id, user.id);
  assert.equal(audits, 1);
  assert.equal((await bind(request(confirm, cookie))).status, 409);
  const differentChat = await open(request(signed(4234423)));
  const other = differentChat.cookies.get(TELEGRAM_BINDING_COOKIE)?.value; assert.ok(other);
  assert.equal((await bind(request(account(), other))).status, 409);
  assert.equal(audits, 1);
  const oldLink = await prisma.telegramLink.findUnique({ where: { userId: user.id } });
  assert.ok(oldLink);
  link = { ...oldLink, chatId: null, linkedAt: null, revokedAt: new Date(Date.now() - 10_000), generation: 2 };
  assert.equal((await bind(request(account(), other))).status, 200);
  user.roles = ["MANAGER"]; user.sessionVersion++;
  assert.equal((await bind(request(confirm, other))).status, 409);
  assert.equal(link.chatId, null);
  assert.equal(audits, 1);
});
