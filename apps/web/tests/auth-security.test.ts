import assert from "node:assert/strict";
import { test } from "node:test";
import { Auth } from "@auth/core";
import { encode } from "@auth/core/jwt";
import type { JWT } from "@auth/core/jwt";
import Credentials from "@auth/core/providers/credentials";
import type { ApiToken } from "@prisma/client";
import type { NextRequest } from "next/server";

import { authConfig } from "../src/auth.config";
import { createSessionCallbacks, type SessionUser } from "../src/server/auth/session-callbacks";
import { createTokenVerifier, hashToken } from "../src/server/plugins/token-verification";
import { isPublicCacheAsset, LEGACY_PRIVATE_CACHES } from "../src/lib/private-cache-policy";
import { databaseHealth } from "../src/server/health";

const secret = "auth-security-test-only-secret-never-used-for-runtime";
const cookieName = "authjs.session-token";
const account: SessionUser = {
  id: "security-test-user",
  email: "auth-test@example.invalid",
  name: "Auth test",
  roles: ["ADMIN"],
  active: true,
  sessionVersion: 3,
};

function issuedToken(changes: Partial<JWT> = {}): JWT {
  return { id: account.id, roles: ["ADMIN"], sessionVersion: 3, ...changes };
}

async function sessionRequest(
  token: JWT,
  findUser: (id: string) => Promise<SessionUser | null>,
) {
  const jwt = await encode({ token, secret, salt: cookieName });
  const response = await Auth(new Request("http://localhost/api/auth/session", {
    headers: { cookie: `${cookieName}=${jwt}` },
  }), {
    basePath: "/api/auth",
    secret,
    trustHost: true,
    session: { strategy: "jwt" },
    providers: [Credentials({ authorize: async () => null })],
    callbacks: { ...authConfig.callbacks, ...createSessionCallbacks(findUser) },
    logger: { error() {}, warn() {}, debug() {} },
  });
  return { response, body: await response.json() };
}

test("Auth.js validates an encrypted JWT against the database and projects current roles", async () => {
  const { body } = await sessionRequest(issuedToken(), async (id) => {
    assert.equal(id, account.id);
    return { ...account, roles: ["WORKER"], name: "Current name" };
  });
  assert.equal(body.user.id, account.id);
  assert.deepEqual(body.user.roles, ["WORKER"]);
  assert.equal(body.user.name, "Current name");
  assert.equal(body.user.sessionVersion, undefined);
});

test("Auth.js rejects a mismatched sessionVersion and removes the old cookie", async () => {
  const { body, response } = await sessionRequest(issuedToken(), async () => ({
    ...account, sessionVersion: account.sessionVersion + 1,
  }));
  assert.equal(body, null);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("disabled and deleted users cannot use even a matching version", async () => {
  for (const current of [{ ...account, active: false }, null]) {
    const { body } = await sessionRequest(issuedToken(), async () => current);
    assert.equal(body, null);
  }
});

test("legacy JWT without sessionVersion is not silently upgraded", async () => {
  const token = issuedToken();
  delete token.sessionVersion;
  let reads = 0;
  const { body } = await sessionRequest(token, async () => { reads++; return account; });
  assert.equal(body, null);
  assert.equal(reads, 0);
});

test("database outage fails closed instead of trusting an old admin claim", async () => {
  const { body } = await sessionRequest(issuedToken(), async () => { throw new Error("unavailable"); });
  assert.equal(body, null);
});

test("route authorization rejects revoked sessions and uses current roles for settings/finance", async () => {
  const request = (pathname: string) => ({ nextUrl: new URL(`http://localhost${pathname}`) }) as NextRequest;
  const revoked = await sessionRequest(issuedToken(), async () => ({ ...account, sessionVersion: 4 }));
  assert.equal(authConfig.callbacks.authorized({ auth: revoked.body, request: request("/settings/users") }), false);
  const worker = await sessionRequest(issuedToken(), async () => ({ ...account, roles: ["WORKER"] }));
  for (const pathname of ["/settings/users", "/changelog", "/finance/payroll"]) {
    const result = authConfig.callbacks.authorized({ auth: worker.body, request: request(pathname) });
    assert.ok(result instanceof Response);
    assert.equal(result.headers.get("location"), "http://localhost/");
  }
  assert.equal(authConfig.callbacks.authorized({ auth: worker.body, request: request("/my") }), true);
});

test("browser session update cannot overwrite a revoked JWT version or roles", async () => {
  const callbacks = createSessionCallbacks(async () => ({ ...account, sessionVersion: 4 }));
  const result = await callbacks.jwt({
    token: issuedToken(), trigger: "update", account: null,
    session: { sessionVersion: 4, roles: ["ADMIN"], id: account.id },
    // Auth.js does not supply a user for an update, only during sign-in.
    user: undefined as never,
  });
  assert.equal(result, null);
});

test("password verification racing with a credential change cannot mint a new valid cookie", async () => {
  const callbacks = createSessionCallbacks(async () => ({ ...account, sessionVersion: 4 }));
  const result = await callbacks.jwt({
    token: issuedToken(), trigger: "signIn", account: null,
    user: { ...account, sessionVersion: 3 },
  });
  assert.equal(result, null);
});

test("revoking one account does not revoke another account", async () => {
  const other = { ...account, id: "other-user", sessionVersion: 3 };
  const findUser = async (id: string) => id === other.id ? other : { ...account, sessionVersion: 4 };
  assert.equal((await sessionRequest(issuedToken(), findUser)).body, null);
  assert.equal((await sessionRequest(issuedToken({ id: other.id }), findUser)).body.user.id, other.id);
});

function apiFixture() {
  const rawToken = "pero_security_fixture";
  const row: ApiToken = {
    id: "test-api-token", name: "test", prefix: "pero_securi", tokenHash: hashToken(rawToken),
    scopes: ["write"], pluginId: null, createdById: account.id,
    createdAt: new Date(), lastUsedAt: null, revokedAt: null,
  };
  let active = true;
  let uses = 0;
  const verify = createTokenVerifier({
    findToken: async (hash) => hash === row.tokenHash ? row : null,
    isOwnerActive: async () => active,
    recordUse: async () => { uses++; },
  });
  return { row, verify, bearer: `Bearer ${rawToken}`, disable: () => { active = false; }, uses: () => uses };
}

test("a user API token is rejected immediately after deactivation", async () => {
  const fixture = apiFixture();
  assert.equal((await fixture.verify(fixture.bearer))?.id, fixture.row.id);
  fixture.disable();
  assert.equal(await fixture.verify(fixture.bearer), null);
  assert.equal(fixture.uses(), 1);
});

test("explicit API revoke also covers ownerless service tokens", async () => {
  const fixture = apiFixture();
  fixture.row.createdById = null;
  fixture.disable();
  assert.ok(await fixture.verify(fixture.bearer));
  fixture.row.revokedAt = new Date();
  assert.equal(await fixture.verify(fixture.bearer), null);
});

test("malformed and unknown Bearer credentials never receive API permissions", async () => {
  const fixture = apiFixture();
  for (const header of [null, "", fixture.bearer.replace("Bearer", "Basic"), "Bearer pero_wrong"]) {
    assert.equal(await fixture.verify(header), null);
  }
  assert.equal(fixture.uses(), 0);
});

test("an API owner lookup failure cannot fall back to token scopes", async () => {
  const fixture = apiFixture();
  const verify = createTokenVerifier({
    findToken: async () => fixture.row,
    isOwnerActive: async () => { throw new Error("unavailable"); },
    recordUse: async () => assert.fail("must not record a successful use"),
  });
  await assert.rejects(verify(fixture.bearer), /unavailable/);
});

test("private pages, RSC, files and exports remain network-only; static app assets can be cached", () => {
  for (const pathname of ["/", "/settings/users", "/projects/test", "/api/auth/session",
    "/api/files/picture.png", "/api/search", "/finance/payroll/export", "/_next/data/build/projects.json", "/_next/image"]) {
    assert.equal(isPublicCacheAsset(pathname), false, pathname);
  }
  for (const pathname of ["/_next/static/chunks/app.js", "/icons/icon-192.png", "/icon.svg"]) {
    assert.equal(isPublicCacheAsset(pathname), true, pathname);
  }
  assert.ok(LEGACY_PRIVATE_CACHES.includes("apis"));
  assert.ok(LEGACY_PRIVATE_CACHES.includes("pages-rsc"));
});

test("health is uncached, fails on unavailable DB and never leaks connection details", async () => {
  const healthy = await databaseHealth(async () => [{ value: 1 }]);
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get("cache-control"), "no-store");
  assert.equal((await healthy.json()).database, "ok");
  const failed = await databaseHealth(async () => { throw new Error("secret-dsn-for-test-only"); });
  assert.equal(failed.status, 503);
  const body = await failed.text();
  assert.doesNotMatch(body, /secret-dsn/);
  assert.match(body, /unavailable/);
});
