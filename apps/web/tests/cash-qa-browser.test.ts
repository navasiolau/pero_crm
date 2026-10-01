import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { cashActionIds, cashActionOutcome, cashAuthCookies, cashAuthCookieHeader, cashManagerSessionMatches,
  validateCashBrowserBinding, pinCashActionIntent } from "./cash-qa-browser.mjs";

const runId = randomUUID();
const plan = { format: "pero-cash-owned-qa/v1", runId,
  target: { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
    host: "127.0.0.1", port: 5433, database: "pero_crm" },
  actors: { managerId: "manager-id", financeId: "finance-id" },
  users: [{ id: "qa-active", name: `QA-CASH ${runId} active`, active: true },
    { id: "qa-inactive", name: `QA-CASH ${runId} inactive`, active: false }],
  accounts: [{ id: "qa-byn", currency: "BYN", active: true }, { id: "qa-usd", currency: "USD", active: true }],
  requestIds: { advance: randomUUID(), salary: randomUUID(), usd: randomUUID(), delete: randomUUID() }, mode: "USD" };
const cookie = (role: string, userId: string) => ({ role, userId, cookie: { name: "authjs.session-token",
  value: `private-cookie-${role}`, domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" } });
const sessions = { origin: "http://127.0.0.1:3106", sessions: [cookie("manager", "manager-id"), cookie("finance", "finance-id")] };

test("browser binding pins origin, exact manager/finance sessions and rejects foreign scope", () => {
  assert.equal(validateCashBrowserBinding({ baseUrl: "http://127.0.0.1:3106/", plan, sessions }).origin,
    "http://127.0.0.1:3106");
  assert.throws(() => validateCashBrowserBinding({ baseUrl: "https://crm.peromebel.by/", plan, sessions }), /TARGET_NOT_ALLOWLISTED/);
  assert.throws(() => validateCashBrowserBinding({ baseUrl: "http://127.0.0.1:3106/", plan,
    sessions: { ...sessions, sessions: [cookie("manager", "other"), cookie("finance", "finance-id")] } }), /SESSION_IDENTITY_MISMATCH/);
  assert.throws(() => validateCashBrowserBinding({ baseUrl: "http://127.0.0.1:3106/", plan,
    sessions: { ...sessions, sessions: [sessions.sessions[0], { ...sessions.sessions[1], cookie: { ...sessions.sessions[1].cookie, secure: true } }] } }), /SESSION_COOKIE_SCOPE/);
});

test("stage binding refuses a lone secure JWT and requires exact companion scope, local remains single-cookie", () => {
  const stagePlan = { ...plan, target: { kind: "EXISTING_STAGING",
    containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
    guest: "crm-staging", host: "db", port: 5432, database: "crm" } };
  const stage = { origin: "https://staging-crm.peromebel.by", sessions: sessions.sessions.map((profile) => ({
    ...profile, cookie: { ...profile.cookie, name: "__Secure-authjs.session-token",
      domain: "staging-crm.peromebel.by", secure: true } })) };
  assert.throws(() => validateCashBrowserBinding({ baseUrl: stage.origin, plan: stagePlan, sessions: stage }),
    /SESSION_COMPANION_COOKIE_SCOPE/);
  const complete = { ...stage, sessions: stage.sessions.map((profile) => ({ ...profile,
    companionCookie: { ...profile.cookie, name: "authjs.session-token", value: `${profile.cookie.value}-companion` } })) };
  const binding = validateCashBrowserBinding({ baseUrl: complete.origin, plan: stagePlan, sessions: complete });
  assert.equal(binding.local, false);
  assert.deepEqual(cashAuthCookies(binding.profiles.manager, complete.origin).map((item) => item.name),
    ["__Secure-authjs.session-token", "authjs.session-token"]);
  assert.equal(cashAuthCookieHeader(binding.profiles.manager, complete.origin),
    `__Secure-authjs.session-token=${complete.sessions[0].cookie.value}; authjs.session-token=${complete.sessions[0].cookie.value}-companion`);
  const foreign = structuredClone(complete);
  foreign.sessions[0].companionCookie.domain = "crm.peromebel.by";
  assert.throws(() => validateCashBrowserBinding({ baseUrl: foreign.origin, plan: stagePlan, sessions: foreign }),
    /SESSION_COMPANION_COOKIE_SCOPE/);
  const localBinding = validateCashBrowserBinding({ baseUrl: sessions.origin, plan, sessions });
  assert.equal(localBinding.local, true);
  assert.deepEqual(cashAuthCookies(localBinding.profiles.manager, sessions.origin).map((item) => item.name), ["authjs.session-token"]);
  assert.equal(cashAuthCookieHeader(localBinding.profiles.manager, sessions.origin),
    `authjs.session-token=${localBinding.profiles.manager.cookie.value}`);
  const localWithCompanion = { ...sessions, sessions: sessions.sessions.map((profile, index) => index === 0 ? ({
    ...profile, companionCookie: { ...profile.cookie, name: "__Secure-authjs.session-token" } }) : profile) };
  assert.throws(() => validateCashBrowserBinding({ baseUrl: sessions.origin, plan, sessions: localWithCompanion }),
    /LOCAL_COMPANION_COOKIE_FORBIDDEN/);
});

test("form requires auth session bound to the planned manager identity and role", () => {
  assert.deepEqual(cashManagerSessionMatches({ user: { id: "manager-id", roles: ["MANAGER"] } }, "manager-id"),
    { idMatches: true, hasManagerRole: true });
  assert.deepEqual(cashManagerSessionMatches({ user: { id: "other", roles: ["MANAGER"] } }, "manager-id"),
    { idMatches: false, hasManagerRole: true });
  assert.deepEqual(cashManagerSessionMatches({ user: { id: "manager-id", roles: ["WORKER"] } }, "manager-id"),
    { idMatches: true, hasManagerRole: false });
});

test("compiled action IDs are bound to reviewed source paths and exported names", () => {
  const specs = [
    ["previewCashPayout", "cash-actions.ts"], ["issueAdvance", "cash-actions.ts"],
    ["addPayout", "actions.ts"], ["deletePayout", "actions.ts"], ["getBellData", "actions.ts"],
  ];
  const node = Object.fromEntries(specs.map(([exportedName, filename], index) =>
    [String(index + 1).repeat(42), { exportedName, filename: filename === "cash-actions.ts"
      ? `D:/Projects/pero_crm_worktrees/manager-cash-advances/apps/web/src/server/payroll/${filename}`
      : exportedName === "getBellData" ? `D:/Projects/pero_crm_worktrees/manager-cash-advances/apps/web/src/server/notifications/${filename}`
        : `D:/Projects/pero_crm_worktrees/manager-cash-advances/apps/web/src/server/payroll/${filename}` }]));
  const ids = cashActionIds({ node });
  assert.equal(ids.issueAdvance, "2".repeat(42));
  assert.throws(() => cashActionIds({ node: { ...node, ["2".repeat(42)]: { ...node["2".repeat(42)], filename: "/other/issueAdvance.ts" } } }),
    /ACTION_MANIFEST_INVALID/);
});

test("form confirmation can only substitute the reserved QA UUID after validating every money field", () => {
  const generated = randomUUID();
  const payload = { userId: plan.users[0].id, cashAccountId: plan.accounts[0].id, cashAmount: "120.00",
    expectedCashCurrency: "BYN", description: `QA-CASH ${runId} advance`, requestId: generated };
  assert.deepEqual(pinCashActionIntent(plan, { kind: "advance120", role: "manager", path: "/advances" }, [payload]),
    [{ ...payload, requestId: plan.requestIds.advance }]);
  assert.throws(() => pinCashActionIntent(plan, { kind: "advance120", role: "manager", path: "/advances" },
    [{ ...payload, userId: "real-user" }]), /ACTION_PAYLOAD_FORBIDDEN/);
  assert.throws(() => pinCashActionIntent(plan, { kind: "advance120", role: "manager", path: "/advances" },
    [{ ...payload, cashAmount: "121.00" }]), /ACTION_PAYLOAD_FORBIDDEN/);
  assert.throws(() => pinCashActionIntent(plan, { kind: "advance120", role: "finance", path: "/advances" },
    [payload]), /ACTION_ROLE_OR_ROUTE_FORBIDDEN/);
});

test("Flight response parser accepts one action result and refuses ambiguity", () => {
  assert.deepEqual(cashActionOutcome(Buffer.from('0:{"ok":true,"payoutId":"qa-payout","repeated":false}\n')),
    { ok: true, payoutId: "qa-payout", repeated: false });
  assert.throws(() => cashActionOutcome(Buffer.from('0:{"ok":true}\n1:{"ok":false}\n')), /ACTION_RESULT_MISSING_OR_AMBIGUOUS/);
});
