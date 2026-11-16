import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire, Module } from "node:module";
import type { NextAuthConfig } from "next-auth";
import type { Prisma } from "@prisma/client";

test("actual Auth config records only validated credential sign-in and keeps audit UUID off token/session", async () => {
  const require = createRequire(import.meta.url), previous = new Map<string, NodeModule | undefined>();
  const inject = (name: string, exports: unknown) => {
    const id = require.resolve(name), stubModule = new Module(id); previous.set(id, require.cache[id]); stubModule.filename = id; stubModule.loaded = true; stubModule.exports = exports; require.cache[id] = stubModule;
  };
  let config: NextAuthConfig | undefined, active = true, passwordValid = true;
  const rows = new Map<string, Prisma.ChangeLogCreateInput>();
  const current = () => ({ id: "auth-user", name: "Иван", email: "ivan@example.invalid", passwordHash: "stored-hash", roles: ["ADMIN"], active, sessionVersion: 0 });
  inject("next-auth", { __esModule: true, default: (value: NextAuthConfig) => { config = value; return {}; } });
  inject("../src/lib/password", { verifyPassword: async () => passwordValid });
  inject("../src/lib/prisma", { prisma: { user: { findUnique: async () => current() }, changeLog: {
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { rows.set(data.id!, data); return data; },
  } } });
  const authPath = require.resolve("../src/auth"); previous.set(authPath, require.cache[authPath]); delete require.cache[authPath];
  try {
    require("../src/auth"); assert.ok(config);
    type Authorize = (credentials: { email: string; password: string }, request: Request) => Promise<null | { id: string; name: string; email: string; roles: string[]; sessionVersion: number; auditLoginId: string }>;
    const provider = config.providers[0] as unknown as { options: { authorize: Authorize } };
    const credentials = { email: "ivan@example.invalid", password: "never-store-this-password" }, request = new Request("https://example.invalid/api/auth/callback/credentials");
    const user = await provider.options.authorize(credentials, request); assert.ok(user); assert.match(user.auditLoginId, /^[0-9a-f-]{36}$/);
    const jwt = config.callbacks!.jwt!, signIn = config.events!.signIn!;
    const argumentsFor = (value: typeof user) => ({ token: { name: value.name, email: value.email, sub: value.id }, user: value, account: null, trigger: "signIn" as const });
    const token = await jwt(argumentsFor(user) as Parameters<typeof jwt>[0]); assert.ok(token); assert.equal("auditLoginId" in token, false);
    await signIn({ user, account: null } as Parameters<typeof signIn>[0]); await signIn({ user, account: null } as Parameters<typeof signIn>[0]);
    assert.equal(rows.size, 1);
    await jwt({ token, account: null, user: undefined as never }); assert.equal(rows.size, 1);
    const session = await config.callbacks!.session!({ session: { user: { name: user.name, email: user.email }, expires: "2099-01-01" }, token } as Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["session"]>>[0]);
    assert.ok(!JSON.stringify(session).includes(user.auditLoginId)); assert.ok(!JSON.stringify([...rows.values()]).includes(credentials.password));
    const deniedUser = await provider.options.authorize(credentials, request); assert.ok(deniedUser); active = false;
    assert.equal(await jwt(argumentsFor(deniedUser) as Parameters<typeof jwt>[0]), null);
    // Именно так Auth.js вызывает event после JWT=null; hook обязан пропустить его.
    await signIn({ user: deniedUser, account: null } as Parameters<typeof signIn>[0]); assert.equal(rows.size, 1);
    active = true; passwordValid = false; assert.equal(await provider.options.authorize(credentials, request), null);
  } finally {
    for (const [id, entry] of previous) { if (entry) require.cache[id] = entry; else delete require.cache[id]; }
  }
});
