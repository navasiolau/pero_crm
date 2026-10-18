import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@prisma/client";
import { createKpBindingAuthorizer, createKpRequestAuthorizer, type KpAuthUser, type KpAuthToken } from "../src/server/kp/api-auth";
import { KpApiError } from "../src/server/kp/api-contract";

function fixture() {
  const user: KpAuthUser = { id: "owner", name: "Владелец", active: true, roles: ["MANAGER"], sessionVersion: 3 };
  const token: KpAuthToken = { id: "key", createdById: user.id, scopes: ["kp:read", "kp:write"], revokedAt: null };
  let sessionCalls = 0, verifyCalls = 0;
  const store = { user: async (id: string) => id === user.id ? { ...user } : null, token: async (id: string) => id === token.id ? { ...token } : null };
  const authorize = createKpRequestAuthorizer({ store,
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
