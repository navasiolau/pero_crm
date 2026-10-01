import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCashStageAbortApproval, assertCashStageBackup, assertCashStageEnvironment,
  cashStageCookieProfile,
  cashStageRefs } from "./cash-stage-entry.mjs";

test("stage entry refuses wrong database endpoint, missing migration SQL or unverifiable backup", () => {
  const sql = Buffer.from("placeholder");
  const env = { DATABASE_URL: "postgresql://crm:private@db:5432/crm" };
  assert.throws(() => assertCashStageEnvironment(env, sql), /STAGING_SOURCE_OR_DATABASE_BINDING_MISMATCH/);
  assert.throws(() => assertCashStageEnvironment({ ...env, DATABASE_URL: "postgresql://crm:private@prod:5432/crm" }, sql),
    /STAGING_SOURCE_OR_DATABASE_BINDING_MISMATCH/);
  const good = { verified: true, targetKind: "EXISTING_STAGING", database: "crm",
    archiveSha256: "a".repeat(64), tocSha256: "b".repeat(64), fullReadSha256: "c".repeat(64) };
  assert.deepEqual(assertCashStageBackup(good), good);
  assert.throws(() => assertCashStageBackup({ ...good, fullReadSha256: null }), /STAGING_BACKUP_PROOF_REQUIRED/);
  assert.throws(() => assertCashStageBackup({ ...good, database: "prod" }), /STAGING_BACKUP_PROOF_REQUIRED/);
});

test("stage refs return only IDs/roles and stop enabled demo hook before fixtures", () => {
  const snapshot = { rows: { User: [JSON.stringify({ id: "M", active: true, roles: ["MANAGER"] }),
    JSON.stringify({ id: "F", active: true, roles: ["ACCOUNTANT"] }),
    JSON.stringify({ id: "X", active: false, roles: ["DIRECTOR"] })],
  Client: [JSON.stringify({ id: "C", name: "Private client" })],
  Plugin: [JSON.stringify({ id: "demo", enabled: false }), JSON.stringify({ id: "file-stages", enabled: true })],
  OrgSetting: [JSON.stringify({ key: "payrollCurrency", value: "BYN" })] } };
  assert.deepEqual(cashStageRefs(snapshot), { managers: [{ id: "M", roles: ["MANAGER"] }],
    finance: [{ id: "F", roles: ["ACCOUNTANT"] }], clientIds: ["C"] });
  snapshot.rows.Plugin[0] = JSON.stringify({ id: "demo", enabled: true });
  assert.throws(() => cashStageRefs(snapshot), /STAGING_PLUGIN_HOOK_UNATTRIBUTABLE/);
  snapshot.rows.Plugin[0] = JSON.stringify({ id: "demo", enabled: false });
  snapshot.rows.OrgSetting[0] = JSON.stringify({ key: "payrollCurrency", value: "USD" });
  assert.throws(() => cashStageRefs(snapshot), /STAGING_PAYROLL_CURRENCY_FORBIDDEN/);
});

test("abort cleanup never accepts a FINAL capture or an unreviewed partial", () => {
  assert.throws(() => assertCashStageAbortApproval({}, { phase: "FINAL" }, { source: "root-reviewed-abort" }),
    /STAGING_ABORT_APPROVAL_REQUIRED/);
  assert.throws(() => assertCashStageAbortApproval({}, { phase: "PARTIAL" }, { source: "auto-abort" }),
    /STAGING_ABORT_APPROVAL_REQUIRED/);
});

test("stage JWT profiles mint both exact secure names with their own salt and 900s TTL", async () => {
  const calls: Array<{ salt: string; maxAge: number; token: { id: string; roles: string[]; sessionVersion: number } }> = [];
  const profile = await cashStageCookieProfile({ id: "manager", roles: ["MANAGER"], sessionVersion: 3 },
    "manager", "private-secret", async (args: { salt: string; maxAge: number; token: { id: string; roles: string[]; sessionVersion: number } }) => {
      calls.push(args); return `signed-${args.salt}`;
    });
  assert.deepEqual(calls.map((call) => call.salt), ["__Secure-authjs.session-token", "authjs.session-token"]);
  assert.ok(calls.every((call) => call.maxAge === 900 && call.token.id === "manager" &&
    call.token.roles.includes("MANAGER") && call.token.sessionVersion === 3));
  assert.equal(profile.cookie.name, "__Secure-authjs.session-token");
  assert.equal(profile.companionCookie.name, "authjs.session-token");
  assert.notEqual(profile.cookie.value, profile.companionCookie.value);
  for (const cookie of [profile.cookie, profile.companionCookie]) {
    assert.equal(cookie.domain, "staging-crm.peromebel.by");
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.path, "/");
    assert.equal(cookie.sameSite, "Lax");
  }
});
