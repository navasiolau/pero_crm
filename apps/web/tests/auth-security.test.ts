import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionCallbacks, type SessionUser } from "../src/server/auth/session-callbacks";
import { isPublicCacheAsset, LEGACY_PRIVATE_CACHES } from "../src/lib/private-cache-policy";

const account: SessionUser = {
  id: "security-test-user", email: "auth-test@example.invalid", name: "Auth test",
  roles: ["ADMIN"], active: true, sessionVersion: 3,
};

test("legacy or malformed JWT version refuses before a current-user lookup", async () => {
  let reads = 0;
  const callbacks = createSessionCallbacks(async () => { reads++; return account; });
  for (const sessionVersion of [undefined, -1, 1.5, Number.NaN]) {
    const result = await callbacks.jwt({ token: { id: account.id, roles: ["ADMIN"], sessionVersion }, account: null, user: undefined as never });
    assert.equal(result, null);
  }
  assert.equal(reads, 0);
});

test("browser update cannot promote the signed version or roles after revocation", async () => {
  const callbacks = createSessionCallbacks(async () => ({ ...account, sessionVersion: 4 }));
  const result = await callbacks.jwt({
    token: { id: account.id, sessionVersion: 3, roles: ["ADMIN"] }, trigger: "update", account: null,
    session: { sessionVersion: 4, roles: ["ADMIN"], id: account.id }, user: undefined as never,
  });
  assert.equal(result, null);
});

test("credential change between password check and sign-in cannot mint a current JWT", async () => {
  const callbacks = createSessionCallbacks(async () => ({ ...account, sessionVersion: 4 }));
  const result = await callbacks.jwt({
    token: {} as Parameters<typeof callbacks.jwt>[0]["token"], trigger: "signIn", account: null, user: { ...account, sessionVersion: 3 },
  });
  assert.equal(result, null);
});

test("private pages, RSC, files and exports stay network-only after access revocation", () => {
  for (const pathname of ["/", "/settings/users", "/projects/test", "/api/auth/session", "/api/files/picture.png",
    "/api/search", "/finance/payroll/export", "/_next/data/build/projects.json", "/_next/image"]) {
    assert.equal(isPublicCacheAsset(pathname), false, pathname);
  }
  for (const pathname of ["/_next/static/chunks/app.js", "/icons/icon-192.png", "/icon.svg"]) {
    assert.equal(isPublicCacheAsset(pathname), true, pathname);
  }
  assert.ok(LEGACY_PRIVATE_CACHES.includes("apis"));
  assert.ok(LEGACY_PRIVATE_CACHES.includes("pages-rsc"));
});
