import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire, Module } from "node:module";
import type { NextAuthConfig, User } from "next-auth";

test("actual Auth config authenticates and refreshes credentials without journal hooks", async () => {
  const require = createRequire(import.meta.url), previous = new Map<string, NodeModule | undefined>();
  const inject = (name: string, exports: unknown) => {
    const id = require.resolve(name), stubModule = new Module(id); previous.set(id, require.cache[id]); stubModule.filename = id; stubModule.loaded = true; stubModule.exports = exports; require.cache[id] = stubModule;
  };
  let config: NextAuthConfig | undefined, active = true, passwordValid = true;
  let journalAccesses = 0;
  const current = () => ({ id: "auth-user", name: "Иван", email: "ivan@example.invalid", passwordHash: "stored-hash", roles: ["ADMIN"], active, sessionVersion: 0 });
  inject("next-auth", { __esModule: true, default: (value: NextAuthConfig) => { config = value; return {}; } });
  inject("../src/lib/password", { verifyPassword: async () => passwordValid });
  inject("../src/lib/prisma", { prisma: {
    user: { findUnique: async () => current() },
    get changeLog() {
      journalAccesses++;
      throw new Error("Авторизация обратилась к Журналу");
    },
  } });
  const authPath = require.resolve("../src/auth"); previous.set(authPath, require.cache[authPath]); delete require.cache[authPath];
  try {
    require("../src/auth"); assert.ok(config);
    assert.equal(config.session?.strategy, "jwt");
    assert.equal(config.events?.signIn, undefined);
    assert.equal(config.events?.signOut, undefined);
    type Authorize = (credentials: { email: string; password: string }, request: Request) => Promise<User | null>;
    const provider = config.providers[0] as unknown as { options: { authorize: Authorize } };
    const credentials = { email: "ivan@example.invalid", password: "never-store-this-password" }, request = new Request("https://example.invalid/api/auth/callback/credentials");
    const user = await provider.options.authorize(credentials, request);
    assert.deepEqual(user, { id: "auth-user", name: "Иван", email: credentials.email, roles: ["ADMIN"], sessionVersion: 0 });
    assert.ok(user);
    const jwt = config.callbacks!.jwt!;
    const argumentsFor = (value: User): Parameters<typeof jwt>[0] => ({
      token: { id: value.id, roles: value.roles, name: value.name, email: value.email, sub: value.id },
      user: value,
      account: null,
      trigger: "signIn",
    });
    const token = await jwt(argumentsFor(user));
    assert.ok(token);
    assert.deepEqual(await jwt({ token, account: null, user: undefined as never }), token);
    const session = await config.callbacks!.session!({ session: { user: { name: user.name, email: user.email }, expires: "2099-01-01" }, token } as Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["session"]>>[0]);
    assert.deepEqual(session.user, { id: user.id, name: user.name, email: user.email, roles: user.roles, sessionVersion: user.sessionVersion });
    const deniedUser = await provider.options.authorize(credentials, request); assert.ok(deniedUser); active = false;
    assert.equal(await jwt(argumentsFor(deniedUser)), null);
    active = true; passwordValid = false; assert.equal(await provider.options.authorize(credentials, request), null);
    assert.equal(journalAccesses, 0);
  } finally {
    for (const [id, entry] of previous) { if (entry) require.cache[id] = entry; else delete require.cache[id]; }
  }
});
