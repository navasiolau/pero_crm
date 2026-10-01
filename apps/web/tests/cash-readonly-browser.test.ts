import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readonlyErrorDiagnostic, validateCashReadonlyBinding, validateCashReadonlyRequest,
  validateObservedNavigation, validateReadonlyRedirect, validateReadonlySession } from "./cash-readonly-browser.mjs";

const runId = "a1677358-663c-4d50-8dc8-d84f3de04680";
const plan = {
  format: "pero-cash-owned-qa/v1",
  runId,
  target: { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
    host: "127.0.0.1", port: 5433, database: "pero_crm" },
  actors: { managerId: "qa-manager", financeId: "qa-finance" },
  users: [{ id: "qa-worker", name: `QA-CASH ${runId} active`, active: true },
    { id: "qa-inactive", name: `QA-CASH ${runId} inactive`, active: false }],
  accounts: [{ id: "cash-byn", name: "QA BYN", currency: "BYN", active: true },
    { id: "cash-usd", name: "QA USD", currency: "USD", active: true }],
  requestIds: { advance: "11111111-1111-4111-8111-111111111111", salary: "22222222-2222-4222-8222-222222222222",
    usd: "33333333-3333-4333-8333-333333333333", delete: "44444444-4444-4444-8444-444444444444" },
  mode: "USD",
};
const cookie = (role: string) => ({ name: "authjs.session-token", value: `session-${role}`, domain: "127.0.0.1",
  path: "/", httpOnly: true, secure: false, sameSite: "Lax" });
const sessions = { origin: "http://127.0.0.1:3106", sessions: [
  { role: "manager", userId: "qa-manager", cookie: cookie("manager") },
  { role: "finance", userId: "qa-finance", cookie: cookie("finance") },
  { role: "worker", userId: "qa-worker", cookie: cookie("worker") },
] };
const actionIds = { getBellData: "1".repeat(42), previewCashPayout: "2".repeat(42), issueAdvance: "3".repeat(42),
  addPayout: "4".repeat(42), deletePayout: "5".repeat(42), settleAll: "6".repeat(42) };

test("readonly binding is local-only and pins manager, finance, and active worker sessions", () => {
  const result = validateCashReadonlyBinding({ baseUrl: sessions.origin, plan, sessions });
  assert.equal(result.origin, sessions.origin);
  assert.equal(result.profiles.worker.userId, plan.users[0].id);
  assert.throws(() => validateCashReadonlyBinding({ baseUrl: "https://staging-crm.peromebel.by", plan, sessions }),
    /LOCAL_READONLY_TARGET_REQUIRED/);
  assert.throws(() => validateCashReadonlyBinding({ baseUrl: sessions.origin, plan,
    sessions: { ...sessions, sessions: sessions.sessions.slice(0, 2) } }), /READONLY_SESSION_SET_INVALID/);
});

test("only allowlisted same-origin readonly GET routes and static assets pass", () => {
  const common = { origin: sessions.origin, method: "GET", role: "manager", plan, actionIds };
  assert.equal(validateCashReadonlyRequest({ ...common, pathname: "/advances" }).kind, "continue");
  assert.equal(validateCashReadonlyRequest({ ...common, pathname: "/finance/payroll/export" }).kind, "continue");
  assert.equal(validateCashReadonlyRequest({ ...common, pathname: "/_next/static/chunk.js" }).kind, "continue");
  assert.equal(validateCashReadonlyRequest({ ...common, pathname: "/advances", headers: { purpose: "prefetch" } }).kind,
    "abort-prefetch");
  assert.throws(() => validateCashReadonlyRequest({ ...common, origin: "https://example.invalid", pathname: "/advances" }),
    /CROSS_ORIGIN_REQUEST_FORBIDDEN/);
  assert.throws(() => validateCashReadonlyRequest({ ...common, pathname: "/finance/accounts" }),
    /GET_OUTSIDE_READONLY_ROUTES/);
});

test("only empty getBellData and the armed exact USD preview can POST", () => {
  const base = { origin: sessions.origin, method: "POST", pathname: "/advances", role: "manager", plan, actionIds };
  assert.equal(validateCashReadonlyRequest({ ...base, headers: { "next-action": actionIds.getBellData }, body: "[]" }).kind, "bell");
  assert.throws(() => validateCashReadonlyRequest({ ...base, headers: { "next-action": actionIds.getBellData }, body: "[{}]" }),
    /BELL_ARGS_FORBIDDEN/);

  const usd = JSON.stringify([{ cashAccountId: "cash-usd", cashAmount: "50.00", expectedCashCurrency: "USD" }]);
  assert.equal(validateCashReadonlyRequest({ ...base, headers: { "next-action": actionIds.previewCashPayout }, body: usd,
    previewArmed: true }).kind, "preview");
  assert.throws(() => validateCashReadonlyRequest({ ...base, headers: { "next-action": actionIds.previewCashPayout }, body: usd,
    previewArmed: false }), /USD_PREVIEW_NOT_ARMED/);
  assert.throws(() => validateCashReadonlyRequest({ ...base, role: "worker", headers: { "next-action": actionIds.previewCashPayout },
    body: usd, previewArmed: true }), /USD_PREVIEW_NOT_ARMED/);
  assert.throws(() => validateCashReadonlyRequest({ ...base, headers: { "next-action": actionIds.previewCashPayout },
    body: JSON.stringify([{ cashAccountId: "cash-usd", cashAmount: "500.00", expectedCashCurrency: "USD" }]), previewArmed: true }),
  /PREVIEW_PAYLOAD_FORBIDDEN/);
});

test("issue, salary, delete, settleAll, and unknown action POSTs are all refused", () => {
  const base = { origin: sessions.origin, method: "POST", pathname: "/advances", role: "manager", plan, actionIds, body: "[]" };
  for (const actionId of [actionIds.issueAdvance, actionIds.addPayout, actionIds.deletePayout, actionIds.settleAll, "unknown-action"]) {
    assert.throws(() => validateCashReadonlyRequest({ ...base, headers: { "next-action": actionId } }),
      /POST_ACTION_FORBIDDEN/);
  }
});

test("normal page navigation requires the expected successful same-origin landing", () => {
  assert.equal(validateObservedNavigation({ expectedPath: "/finance/payroll", responseStatus: 200,
    responsePath: "/finance/payroll", finalPath: "/finance/payroll" }), "/finance/payroll");
  assert.throws(() => validateObservedNavigation({ expectedPath: "/finance/payroll", responseStatus: 0,
    responsePath: "/finance/payroll", finalPath: "/finance/payroll" }), /NAVIGATION_RESPONSE_FAILED/);
  assert.throws(() => validateObservedNavigation({ expectedPath: "/", responseStatus: 200,
    responsePath: "/login", finalPath: "/login" }), /AUTH_LANDING_PATH_MISMATCH/);
});

test("readonly ACL probes require an authenticated role and exact local redirect without payroll data", () => {
  assert.equal(validateReadonlySession({ user: { id: "qa-manager", roles: ["MANAGER"] } }, sessions.sessions[0]), true);
  assert.equal(validateReadonlySession({ user: { id: "qa-worker", roles: ["WORKER"] } }, sessions.sessions[2]), true);
  assert.throws(() => validateReadonlySession({ user: { id: "", roles: ["WORKER"] } }, sessions.sessions[2]),
    /AUTH_SESSION_IDENTITY_MISMATCH/);
  assert.throws(() => validateReadonlySession({ user: { id: "qa-worker", roles: ["ACCOUNTANT"] } }, sessions.sessions[2]),
    /AUTH_SESSION_ROLE_MISMATCH/);
  for (const status of [302, 303, 307, 308]) {
    assert.deepEqual(validateReadonlyRedirect({ status, location: "/", requestedUrl: `${sessions.origin}/finance/payroll`,
      expectedPath: "/" }), { status, locationOrigin: sessions.origin, locationPath: "/" });
  }
  assert.deepEqual(validateReadonlyRedirect({ status: 307, location: "/",
    requestedUrl: `${sessions.origin}/advances`, expectedPath: "/" }).locationPath, "/");
  for (const location of ["https://localhost:3106/", "http://localhost:3107/", "http://127.0.0.1:3107/",
    "http://example.invalid/"]) {
    assert.throws(() => validateReadonlyRedirect({ status: 302, location,
      requestedUrl: `${sessions.origin}/finance/payroll`, expectedPath: "/" }), /AUTH_REDIRECT_LOCATION_INVALID/);
  }
  assert.throws(() => validateReadonlyRedirect({ status: 200, location: "/", requestedUrl: `${sessions.origin}/advances`,
    expectedPath: "/my" }), /AUTH_REDIRECT_NOT_RETURNED/);
  assert.throws(() => validateReadonlyRedirect({ status: 302, location: "/my", requestedUrl: `${sessions.origin}/advances`,
    expectedPath: "/" }), /AUTH_REDIRECT_LOCATION_INVALID/);
  assert.throws(() => validateReadonlyRedirect({ status: 302, location: "/", requestedUrl: `${sessions.origin}/finance/payroll/export?month=2026-09`,
    expectedPath: "/", contentType: "text/csv; charset=utf-8" }), /UNAUTHORIZED_EXPORT_CONTENT_TYPE/);
  assert.throws(() => validateReadonlyRedirect({ status: 302, location: "/", requestedUrl: `${sessions.origin}/finance/payroll`,
    expectedPath: "/", body: `payroll ${plan.users[1].name} 300 BYN` }), /UNAUTHORIZED_PAYROLL_BODY/);
});

test("raw advances denial matches auth.config immediate redirect before home-route resolution", () => {
  const authConfig = readFileSync(fileURLToPath(new URL("../src/auth.config.ts", import.meta.url)), "utf8");
  assert.match(authConfig, /pathname\.startsWith\("\/advances"\)[\s\S]{0,140}Response\.redirect\(new URL\("\/", request\.nextUrl\)\)/);
});

test("readonly diagnostics retain phase and exception class without copying raw messages", () => {
  const diagnostic = readonlyErrorDiagnostic("usd-preview-error", new Error("strict mode violation https://127.0.0.1:3106/path?token=secret cookie=private"), "TIMEOUT");
  assert.equal(diagnostic.phase, "usd-preview-error");
  assert.equal(diagnostic.errorClass, "Error");
  assert.equal(diagnostic.code, "TIMEOUT");
  assert.match(diagnostic.detail, /strict mode violation/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret|hidden/i);
  assert.doesNotMatch(JSON.stringify(diagnostic), /https?:\/\//i);
});
