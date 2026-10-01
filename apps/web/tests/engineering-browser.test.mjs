import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { validateEngineeringBrowserInput, engineeringActionOutcome, engineeringReadOnlyActionIds } from "./engineering-browser.mjs";

function input() {
  const runId = randomUUID();
  const ids = Array.from({ length: 9 }, () => randomUUID());
  const [project, product, pool, legacyWork, a, b, e1, e2, w] = ids;
  const users = [{ id: e1, roles: ["ENGINEER"], name: "E1" }, { id: e2, roles: ["ENGINEER"], name: "E2" },
    { id: w, roles: ["WORKER"], name: "W" }];
  const plan = { format: "pero-engineering-owned-qa/v1", runId,
    target: { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
      host: "127.0.0.1", port: 5433, database: "pero_crm" }, managerId: randomUUID(),
    ids: { project, product, pool, legacyWork, legacyTasks: [a, b], users: [e1, e2, w] },
    project: { number: `QA-ENG-${runId}`, title: "QA project" }, product: { number: `QA-ENG-${runId}-1`, title: "QA product" },
    legacy: { title: "QA legacy", tasks: [{ id: a, title: "A", quantity: "2.00", status: "DONE" }, { id: b, title: "B", quantity: "3.00", status: "NEW" }] },
    newWorkTitle: `QA ${runId} new engineering`, newWorkQuantity: "10.30", users };
  const roles = ["manager", "e1", "e2", "worker"];
  const usersBySession = [plan.managerId, e1, e2, w];
  const sessions = { origin: "http://127.0.0.1:3106", ttlSeconds: 900, sessions: roles.map((role, i) => ({ role, userId: usersBySession[i],
    cookie: { name: "authjs.session-token", value: `signed-${i}`, domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" } })) };
  return { baseUrl: "http://127.0.0.1:3106/", plan, sessions, outputDir: "C:\\Temp\\private" };
}

test("exact local target and four distinct signed sessions pass read-only input validation", () => {
  const value = input();
  value.plan.baseline = { ApiToken: "a".repeat(64) };
  assert.equal(validateEngineeringBrowserInput(value).origin, "http://127.0.0.1:3106");
  assert.throws(() => validateEngineeringBrowserInput({ ...value, baseUrl: "http://127.0.0.1:3000/" }), /TARGET/);
  assert.throws(() => validateEngineeringBrowserInput({ ...value, plan: { ...value.plan, passwordHash: "secret" } }), /SECRET/);
  assert.throws(() => validateEngineeringBrowserInput({ ...value, sessions: { ...value.sessions, sessions: value.sessions.sessions.slice(1) } }), /SESSION/);
});

test("staging target requires its exact DB identity and secure cookie scope", () => {
  const value = input();
  value.baseUrl = "https://staging-crm.peromebel.by/";
  value.plan.target = { kind: "EXISTING_STAGING", containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
    guest: "crm-staging", host: "db", port: 5432, database: "crm" };
  value.sessions.origin = "https://staging-crm.peromebel.by";
  for (const profile of value.sessions.sessions) Object.assign(profile.cookie, { name: "__Secure-authjs.session-token",
    domain: "staging-crm.peromebel.by", secure: true });
  assert.equal(validateEngineeringBrowserInput(value).local, false);
  value.plan.target.database = "pero_crm";
  assert.throws(() => validateEngineeringBrowserInput(value), /TARGET_IDENTITY/);
});

test("Next Flight result parser accepts exactly one real action result", () => {
  assert.deepEqual(engineeringActionOutcome(Buffer.from('0:{"ok":true,"result":{"settlementId":"s"}}\n')), { ok: true, result: { settlementId: "s" } });
  assert.throws(() => engineeringActionOutcome(Buffer.from('0:{"ok":true}\n1:{"ok":true}\n')), /AMBIGUOUS/);
});

test("read-only POST allowance is bound to exact compiled export and source file", () => {
  const node = Object.fromEntries([
    ["getBellData", "notifications/actions.ts"], ["getTaskSplitOptions", "tasks/share-actions.ts"],
    ["fetchProductOptions", "products/actions.ts"],
  ].map(([name, source], i) => [String(i + 1).repeat(42), { exportedName: name, filename: `C:/workspace/src/server/${source}` }]));
  assert.deepEqual([...engineeringReadOnlyActionIds({ node }).values()].sort(), ["fetchProductOptions", "getBellData", "getTaskSplitOptions"]);
  const standalone = structuredClone(node);
  for (const row of Object.values(standalone)) row.filename = row.filename.split("/src/")[1];
  assert.equal(engineeringReadOnlyActionIds({ node: standalone }).size, 3);
  const forged = structuredClone(node);
  Object.values(forged)[0].filename = "C:/workspace/src/server/tasks/actions.ts";
  assert.throws(() => engineeringReadOnlyActionIds({ node: forged }), /MANIFEST/);
});
