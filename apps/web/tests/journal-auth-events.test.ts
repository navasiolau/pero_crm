import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma } from "@prisma/client";
import { createJournalAuthEvents, recordAuthenticationEvent, markJournalSignIn } from "../src/server/auth/journal-events";
import { createSessionCallbacks } from "../src/server/auth/session-callbacks";

const loginId = "10000000-0000-4000-8000-000000000228", logoutId = "20000000-0000-4000-8000-000000000228";
const user = { id: "user-228", name: "Иван", email: "ivan@example.invalid", roles: ["ADMIN"] as const, sessionVersion: 0, auditLoginId: loginId };
function store() {
  const rows = new Map<string, Prisma.ChangeLogCreateInput>(); let fail = false;
  const db = { changeLog: { findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (fail) throw new Error("DB_PASSWORD=secret");
      if (rows.has(data.id!)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
      rows.set(data.id!, data); return data; },
  } };
  return { db: db as unknown as Pick<Prisma.TransactionClient, "changeLog">, rows, setFail: () => { fail = true; } };
}

test("successful auth hooks deduplicate per operation and never store JWT or password", async () => {
  const f = store(), errors: unknown[] = [], events = createJournalAuthEvents(f.db, diagnostic => { errors.push(diagnostic); });
  const input = { user: { ...user, roles: [...user.roles], password: "password-secret" }, account: null };
  markJournalSignIn(input.user, true);
  await Promise.all([events.signIn(input), events.signIn(input)]);
  await events.signOut({ token: { id: user.id, name: user.name, email: user.email, roles: [...user.roles], jti: logoutId, accessToken: "raw-jwt-secret" } });
  await events.signOut({ token: { id: user.id, name: user.name, roles: [...user.roles], jti: logoutId } });
  assert.deepEqual([...f.rows.values()].map(row => row.action), ["login", "logout"]); assert.equal(errors.length, 0);
  assert.ok(!JSON.stringify([...f.rows.values()]).includes("password-secret")); assert.ok(!JSON.stringify([...f.rows.values()]).includes("raw-jwt-secret"));
});

test("authentication audit failure emits a fixed safe diagnostic and does not throw", async () => {
  const f = store(); f.setFail(); const errors: unknown[] = [];
  const events = createJournalAuthEvents(f.db, diagnostic => { errors.push(diagnostic); });
  const input = { user: { ...user, roles: [...user.roles] }, account: null }; markJournalSignIn(input.user, true);
  await events.signIn(input);
  await events.signOut({ token: { id: user.id, name: user.name, roles: [...user.roles], jti: logoutId } });
  assert.equal(f.rows.size, 0); assert.equal(errors.length, 2);
  assert.ok(!JSON.stringify(errors).includes("DB_PASSWORD")); assert.ok(!JSON.stringify(errors).includes("secret"));
});

test("Auth.js signIn callback after rejected JWT is not reported as a successful login", async () => {
  const f = store(), events = createJournalAuthEvents(f.db), input = { user: { ...user, roles: [...user.roles] }, account: null };
  await events.signIn(input); assert.equal(f.rows.size, 0);
  markJournalSignIn(input.user, true); markJournalSignIn(input.user, false);
  await events.signIn(input); assert.equal(f.rows.size, 0);
});

test("session refresh does not create auth audit and private login UUID is absent from JWT/session", async () => {
  let reads = 0;
  const callback = createSessionCallbacks(async () => { reads++; return { ...user, roles: [...user.roles], active: true }; });
  const token = await callback.jwt({ token: { id: user.id, sessionVersion: 0, roles: [...user.roles] }, user: { ...user, roles: [...user.roles] } } as Parameters<typeof callback.jwt>[0]);
  assert.ok(token); assert.equal("auditLoginId" in token, false);
  await callback.jwt({ token } as Parameters<typeof callback.jwt>[0]); assert.equal(reads, 2);
  const events = createJournalAuthEvents(store().db);
  assert.deepEqual(Object.keys(events).sort(), ["signIn", "signOut"]);
});

test("real Auth.js signOut clears session cookie even when its audit callback rejects", async () => {
  const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve("next-auth"));
  const coreRoot = dirname(coreRequire.resolve("@auth/core"));
  const { signOut } = await import(pathToFileURL(join(coreRoot, "lib/actions/signout.js")).href) as {
    signOut: (cookies: unknown[], sessionStore: unknown, options: unknown) => Promise<{ cookies: { name: string; value: string }[] }>;
  };
  let cleaned = false, errors = 0;
  const result = await signOut([], { value: "encrypted-cookie-never-logged", clean: () => { cleaned = true; return [{ name: "authjs.session-token", value: "" }]; } }, {
    jwt: { decode: async () => ({ id: user.id, jti: logoutId }) }, cookies: { sessionToken: { name: "authjs.session-token" } },
    callbackUrl: "/login", session: { strategy: "jwt" }, logger: { error: () => { errors++; } }, events: { signOut: async () => { throw new Error("audit refused"); } },
  });
  assert.equal(cleaned, true); assert.equal(errors, 1); assert.equal(result.cookies[0]?.value, "");
});

test("an operation ID already bound to another user is rejected without a new row", async () => {
  const f = store(); await recordAuthenticationEvent(f.db, { action: "login", operationId: loginId, userId: user.id, name: user.name });
  await assert.rejects(() => recordAuthenticationEvent(f.db, { action: "login", operationId: loginId, userId: "another", name: "Другой" }), /AUTH_AUDIT_ID_CONFLICT/);
  assert.equal(f.rows.size, 1);
});

test("concurrent callback deliveries with one UUID keep one durable event", async () => {
  const f = store(), event = { action: "login" as const, operationId: loginId, userId: user.id, name: user.name };
  const results = await Promise.all([recordAuthenticationEvent(f.db, event), recordAuthenticationEvent(f.db, event)]);
  assert.deepEqual(results.sort(), [false, true]); assert.equal(f.rows.size, 1);
});
