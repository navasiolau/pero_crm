import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@prisma/client";
import { createKpBindingAuthorizer, createKpRequestAuthorizer, type KpAuthUser, type KpAuthToken } from "../src/server/kp/api-auth";
import { KpApiError } from "../src/server/kp/api-contract";

function fixture(configuredOrigin?: string) {
  const user: KpAuthUser = { id: "owner", name: "Владелец", active: true, roles: ["MANAGER"], sessionVersion: 3 };
  const token: KpAuthToken = { id: "key", createdById: user.id, scopes: ["kp:read", "kp:write"], revokedAt: null };
  let sessionCalls = 0, verifyCalls = 0;
  const store = { user: async (id: string) => id === user.id ? { ...user } : null, token: async (id: string) => id === token.id ? { ...token } : null };
  const authorize = createKpRequestAuthorizer({ store, configuredOrigin,
    verify: async header => { verifyCalls++; return header === "Bearer pero_valid" ? { id: token.id, name: "Key", scopes: ["admin"], pluginId: null } : null; },
    session: async () => { sessionCalls++; return { user: { id: user.id, sessionVersion: 3 } }; },
  });
  return { user, token, store, authorize, counts: () => ({ sessionCalls, verifyCalls }) };
}
const bearer = () => new Request("https://crm.example.invalid/api/v1/kp/documents", { headers: { authorization: "Bearer pero_valid", cookie: "valid-session" } });
const error = (status: number) => (value: unknown) => value instanceof KpApiError && value.status === status;

test("v1 requires Bearer without cookie fallback and ignores stale verified scopes", async () => {
  const f = fixture(); await assert.rejects(f.authorize(new Request("https://crm.example.invalid/api/v1/kp/documents", { headers: { cookie: "valid" } }), "bearer", "kp:read"), error(401));
  assert.equal(f.counts().sessionCalls, 0);
  assert.equal((await f.authorize(bearer(), "bearer", "kp:read")).actor.id, "owner");
  f.token.scopes = ["admin", "read", "write"];
  await assert.rejects(f.authorize(bearer(), "bearer", "kp:read"), error(403));
});
test("unowned, revoked, inactive and role-ineligible keys fail even with explicit scopes", async () => {
  const f = fixture(); f.token.createdById = null;
  await assert.rejects(f.authorize(bearer(), "bearer", "kp:read"), error(401));
  f.token.createdById = "owner"; f.token.revokedAt = new Date(0);
  await assert.rejects(f.authorize(bearer(), "bearer", "kp:read"), error(401));
  f.token.revokedAt = null; f.user.active = false;
  await assert.rejects(f.authorize(bearer(), "bearer", "kp:read"), error(401));
  f.user.active = true;
  for (const roles of [["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"], ["WORKER"], ["MOUNTER"]] as Role[][]) {
    f.user.roles = roles; await assert.rejects(f.authorize(bearer(), "bearer", "kp:read"), error(403));
  }
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["MANAGER", "ENGINEER"]] as Role[][]) {
    f.user.roles = roles; assert.deepEqual((await f.authorize(bearer(), "bearer", "kp:read")).actor.roles, roles);
  }
});
test("IO/finalize callbacks recheck scope, owner, role and revocation instead of trusting request snapshot", async () => {
  const f = fixture(); const context = await f.authorize(bearer(), "bearer", "kp:read");
  f.token.scopes = ["kp:write"]; await assert.rejects(context.authorize(), error(403));
  f.token.scopes = ["kp:read"]; f.token.createdById = "different-owner"; await assert.rejects(context.authorize(), error(401));
  f.token.createdById = "owner"; f.user.roles = ["ENGINEER"]; await assert.rejects(context.authorize(), error(403));
  f.user.roles = ["MANAGER"]; f.token.revokedAt = new Date(); await assert.rejects(context.authorize(), error(401));
});
test("web mutations require exact Origin and a JWT session stamp, read requests remain authenticated", async () => {
  const f = fixture(); const url = "https://crm.example.invalid/api/kp/documents";
  for (const origin of [undefined, "null", "https://evil.invalid", "https://crm.example.invalid.evil.invalid", "https://crm.example.invalid/extra", "https://crm.example.invalid?x=1"]) {
    await assert.rejects(f.authorize(new Request(url, { method: "POST", headers: origin ? { origin } : {} }), "session", "kp:write"), error(403));
  }
  const context = await f.authorize(new Request(url, { method: "POST", headers: { origin: "https://crm.example.invalid" } }), "session", "kp:write");
  assert.equal(context.binding.sessionVersion, 3); f.user.sessionVersion = 4; await assert.rejects(context.authorize(), error(401));
  const byBinding = createKpBindingAuthorizer(f.store);
  await assert.rejects(byBinding({ id: "owner", source: "web" }, "kp:read"), error(401));
});
test("job/artifact scope alternatives still require the actual result's dedicated scope", async () => {
  const f = fixture(); f.token.scopes = ["kp:contracts:read"];
  const context = await f.authorize(bearer(), "bearer", ["kp:read", "kp:contracts:read"]);
  await context.authorize("kp:contracts:read"); await assert.rejects(context.authorize("kp:read"), error(403));
});

const proxyUrl = "http://0.0.0.0:3000/api/kp/documents/owned";
const publicOrigin = "https://staging-crm.peromebel.by";
function proxyRequest(overrides: Record<string, string> = {}, duplicate?: [string, string]) {
  const headers = new Headers({ origin: publicOrigin, host: "staging-crm.peromebel.by", "x-forwarded-proto": "http", "sec-fetch-site": "same-origin", ...overrides });
  if (duplicate) headers.append(...duplicate);
  return new Request(proxyUrl, { method: "PUT", headers });
}
test("web mutation uses proxy authority rather than standalone internal request.url", async () => {
  const authorities: Record<string, string>[] = [{}, { host: "web:3000", "x-forwarded-host": "staging-crm.peromebel.by" }, { "x-forwarded-host": "STAGING-CRM.PEROMEBEL.BY:443" }];
  for (const headers of authorities) {
    const f = fixture(); const context = await f.authorize(proxyRequest(headers), "session", "kp:write");
    assert.equal(context.actor.id, "owner");assert.equal(context.binding.source, "web");assert.equal(f.counts().verifyCalls, 0);
  }
});
test("configured canonical origin wins over forwarded host and retains scheme and port checks", async () => {
  const f = fixture(publicOrigin);await f.authorize(proxyRequest(), "session", "kp:write");
  await f.authorize(proxyRequest({ host: "web:3000", "x-forwarded-host": "other.example.invalid" }), "session", "kp:write");
  for (const origin of ["http://staging-crm.peromebel.by", "https://staging-crm.peromebel.by:444", "https://evil.invalid"])
    await assert.rejects(f.authorize(proxyRequest({ origin, "x-forwarded-host": new URL(origin).host }), "session", "kp:write"), error(403));
  const withAuthPath = fixture(publicOrigin + "/api/auth");await withAuthPath.authorize(proxyRequest(), "session", "kp:write");
  for (const configured of ["", "not a URL", "https://user:pass@staging-crm.peromebel.by", publicOrigin + "?x=1", publicOrigin + "#fragment", "https://*.peromebel.by"])
    await assert.rejects(fixture(configured).authorize(proxyRequest(), "session", "kp:write"), error(403));
});
test("proxy origin guard rejects malformed or duplicated authority and fetch metadata", async () => {
  const malformed: Record<string, string>[] = [
    { origin: "null" }, { origin: "https:staging-crm.peromebel.by" }, { origin: "https:///staging-crm.peromebel.by" },
    { origin: publicOrigin + "/path" }, { origin: "https://user@staging-crm.peromebel.by" }, { origin: publicOrigin + "?x=1" },
    { host: "staging-crm.peromebel.by/path" }, { host: "staging-crm.peromebel.by:invalid" },
    { "x-forwarded-host": "" }, { "x-forwarded-host": "https://staging-crm.peromebel.by" }, { "x-forwarded-host": "evil@staging-crm.peromebel.by" },
    { "x-forwarded-host": "staging-crm.peromebel.by,evil.invalid" }, { "x-forwarded-host": "staging-crm..peromebel.by" },
    { "x-forwarded-host": "*.peromebel.by" }, { "x-forwarded-host": "staging-crm.peromebel.by:0" },
    { "x-forwarded-proto": "https,http" }, { "x-forwarded-proto": "ftp" }, { "sec-fetch-site": "unknown" }, { "sec-fetch-site": "same-origin,cross-site" },
  ];
  for (const headers of malformed) await assert.rejects(fixture().authorize(proxyRequest(headers), "session", "kp:write"), error(403));
  for (const name of ["origin", "host", "x-forwarded-host", "x-forwarded-proto", "sec-fetch-site"]) {
    const duplicate: [string, string] = [name, name === "origin" ? publicOrigin : name === "x-forwarded-proto" ? "http" : name === "sec-fetch-site" ? "same-origin" : "staging-crm.peromebel.by"];
    await assert.rejects(fixture().authorize(proxyRequest(name === "x-forwarded-host" ? { [name]: "staging-crm.peromebel.by" } : {}, duplicate), "session", "kp:write"), error(403));
  }
});
test("same-host proxy fallback never permits missing, foreign or cross-site Origin", async () => {
  const refused: Record<string, string>[] = [{ origin: "https://evil.invalid" }, { origin: "https://staging-crm.peromebel.by.evil.invalid" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of refused)
    await assert.rejects(fixture().authorize(proxyRequest(headers), "session", "kp:write"), error(403));
  const missing = proxyRequest();missing.headers.delete("origin");await assert.rejects(fixture().authorize(missing, "session", "kp:write"), error(403));
  const noHost = proxyRequest();noHost.headers.delete("host");await assert.rejects(fixture().authorize(noHost, "session", "kp:write"), error(403));
  const bodyOrigin = new Request(proxyUrl, { method: "PUT", headers: { host: "staging-crm.peromebel.by", "content-type": "application/json" }, body: JSON.stringify({ origin: publicOrigin }) });
  await assert.rejects(fixture().authorize(bodyOrigin, "session", "kp:write"), error(403));
});
test("direct local HTTP and authenticated reads preserve their existing contracts", async () => {
  const f = fixture();await f.authorize(new Request("http://127.0.0.1:3000/api/kp/documents", { method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" } }), "session", "kp:write");
  await f.authorize(new Request("http://[::1]:3000/api/kp/documents", { method: "POST", headers: { origin: "http://[::1]:3000", host: "[::1]:3000" } }), "session", "kp:write");
  assert.equal((await f.authorize(new Request(proxyUrl), "session", "kp:read")).actor.id, "owner");
});
