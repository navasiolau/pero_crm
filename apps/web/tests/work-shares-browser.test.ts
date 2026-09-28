import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkSharesBrowserRedactor, validateWorkSharesBrowserInput, validateWorkSharesCompletionIds, workSharesSessionCookies, workSharesTimerSeconds } from "./work-shares-browser.mjs";

for (const [label, expected] of [
  ["Стоп 00:01", 1],
  ["Стоп 00:19", 19],
  ["Стоп 01:00", 60],
  ["Стоп 00:00", 0],
  ["Стоп 59:59", 3599],
  ["Стоп 1:00:00", 3600],
  ["Стоп 01:02:03", 3723],
  ["Стоп 00:00:01", 1],
  ["Стоп 00:00:00", 0],
] as const) {
  test(`timer parses the actual padded label ${label} into seconds`, () => {
    const seconds = workSharesTimerSeconds(label);
    assert.equal(seconds, expected);
    assert.equal((seconds ?? -1) >= 1, expected >= 1);
  });
}

test("invalid or missing timer text cannot prove elapsed time", () => {
  for (const label of ["", "Стоп", "Стоп 00:60", "Стоп 1:60:00", "Стоп -1:00", "Стоп 00:19 ошибка", "Выполнено 00:19"]) {
    assert.equal(workSharesTimerSeconds(label), null, label);
  }
});

const completionPlan = {
  source: { id: "11111111-1111-4111-8111-111111111111" },
  dependent: { id: "22222222-2222-4222-8222-222222222222" },
  project: { id: "33333333-3333-4333-8333-333333333333" },
  work: { id: "44444444-4444-4444-8444-444444444444" },
  users: [{ id: "55555555-5555-4555-8555-555555555555" }, { id: "66666666-6666-4666-8666-666666666666" }],
};
const capturedIds = {
  source: completionPlan.source.id,
  dependent: completionPlan.dependent.id,
  fractional: "qa_observed_fractional_task",
  child: "qa_observed_split_task",
  splitRequestId: "77777777-7777-4777-8777-777777777777",
};

test("readonly completion binds the observed IDs to the owned plan", () => {
  const result = validateWorkSharesCompletionIds(completionPlan, capturedIds);
  assert.deepEqual(result, capturedIds);
  assert.notEqual(result, capturedIds);
});

test("readonly completion rejects missing, extra or mismatched receipt identifiers", () => {
  for (const ids of [undefined, {}, { ...capturedIds, token: "forbidden" }, { ...capturedIds, source: capturedIds.child }, { ...capturedIds, dependent: capturedIds.child }, { ...capturedIds, splitRequestId: "missing-real-request" }]) {
    assert.throws(() => validateWorkSharesCompletionIds(completionPlan, ids), /COMPLETION_CAPTURED_IDS_/);
  }
});

test("readonly completion rejects aliased tasks, path-shaped IDs and non-task owned IDs", () => {
  for (const ids of [{ ...capturedIds, child: capturedIds.fractional }, { ...capturedIds, fractional: null }, { ...capturedIds, child: "../foreign-task" }, { ...capturedIds, child: completionPlan.project.id }, { ...capturedIds, fractional: completionPlan.work.id }, { ...capturedIds, child: completionPlan.users[0].id }]) {
    assert.throws(() => validateWorkSharesCompletionIds(completionPlan, ids), /COMPLETION_TASK_IDS_INVALID/);
  }
});

function sessionInput(staging = true, withCompanion = false) {
  const runId = "88888888-8888-4888-8888-888888888888";
  const baseUrl = staging ? "https://staging-crm.peromebel.by" : "http://localhost:3105";
  const plan = {
    runId,
    project: { ...completionPlan.project, number: `LOCAL-QA-${runId}`, title: `Project ${runId}` },
    work: { ...completionPlan.work, title: `Work ${runId}` },
    source: { ...completionPlan.source, title: `Source ${runId}` },
    dependent: { ...completionPlan.dependent, title: `Dependent ${runId}` },
    users: completionPlan.users.map((user, index) => ({ ...user, name: `Employee ${index} ${runId}`, roles: [index === 0 ? "WORKER" : "MOUNTER"] })),
    fractionalTitle: `Fractional ${runId}`,
    taskType: `QA ${runId}`,
    dueAt: "2026-09-30T12:00:00.000Z",
    currency: "BYN",
  };
  const sessions = ["manager", "worker", "mounter"].map((role, index) => {
    const cookie = { name: staging ? "__Secure-authjs.session-token" : "authjs.session-token", value: `primary-private-${role}`, domain: new URL(baseUrl).hostname, path: "/", httpOnly: true, secure: staging, sameSite: "Lax" };
    return { role, userId: index === 0 ? "qa-existing-manager" : plan.users[index - 1].id, cookie, companionCookie: withCompanion ? { ...cookie, name: "authjs.session-token", value: `companion-private-${role}`, secure: true } : undefined };
  });
  return { baseUrl, plan, sessions };
}

test("the original single-cookie contract still works locally and on staging", () => {
  for (const staging of [false, true]) {
    const input = sessionInput(staging);
    assert.doesNotThrow(() => validateWorkSharesBrowserInput(input));
    const profile = input.sessions[0];
    const cookies = workSharesSessionCookies(profile);
    assert.deepEqual(cookies, [profile.cookie]);
    assert.notEqual(cookies[0], profile.cookie);
  }
});

test("staging companion and primary cookies both reach the browser context", () => {
  const input = sessionInput(true, true);
  assert.doesNotThrow(() => validateWorkSharesBrowserInput(input));
  for (const profile of input.sessions) {
    const cookies = workSharesSessionCookies(profile);
    assert.deepEqual(cookies, [profile.cookie, profile.companionCookie]);
    assert.notEqual(cookies[1], profile.companionCookie);
  }
});

test("companion cookies are forbidden for local and non-allowlisted origins", () => {
  assert.throws(() => validateWorkSharesBrowserInput(sessionInput(false, true)), /COMPANION_COOKIE_STAGE_ONLY/);
  for (const baseUrl of ["http://staging-crm.peromebel.by", "https://crm.peromebel.by", "https://staging-crm.peromebel.by.evil.example"]) {
    assert.throws(() => validateWorkSharesBrowserInput({ ...sessionInput(true, true), baseUrl }), /TARGET_NOT_ALLOWLISTED/);
  }
});

test("staging companion namespace, domain, path and security flags are strict", () => {
  const invalid = [
    { name: "__Secure-authjs.session-token" }, { name: "other-token" }, { value: "" },
    { domain: ".staging-crm.peromebel.by" }, { domain: "localhost" }, { path: "/my" },
    { secure: false }, { httpOnly: false }, { sameSite: "None" }, { sameSite: "Strict" },
  ];
  for (const changes of invalid) {
    const input = sessionInput(true, true);
    Object.assign(input.sessions[0].companionCookie!, changes);
    assert.throws(() => validateWorkSharesBrowserInput(input), /COMPANION_COOKIE_/);
  }
});

test("companion tokens cannot duplicate a primary token or another actor companion", () => {
  for (const duplicated of ["primary-private-manager", "primary-private-worker", "companion-private-worker"]) {
    const input = sessionInput(true, true);
    input.sessions[0].companionCookie!.value = duplicated;
    assert.throws(() => validateWorkSharesBrowserInput(input), /COMPANION_COOKIE_DUPLICATE/);
  }
});

test("diagnostics redact every primary and companion token plus HTTP credentials", () => {
  const { sessions } = sessionInput(true, true);
  const httpCredentials = { username: "qa-basic-user", password: "qa-basic-password" };
  const secrets = sessions.flatMap((profile) => [profile.cookie.value, profile.companionCookie!.value]);
  secrets.push(httpCredentials.username, httpCredentials.password, Buffer.from(`${httpCredentials.username}:${httpCredentials.password}`).toString("base64"));
  const redact = createWorkSharesBrowserRedactor(sessions, httpCredentials);
  assert.equal(redact(secrets.join(" | ")), secrets.map(() => "[REDACTED]").join(" | "));
});
