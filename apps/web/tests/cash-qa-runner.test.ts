import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { cashQaSchemaTables, cashRawFingerprints } from "./cash-owned-fixtures.mjs";
import { assertCashQaSource, assertCashStartupDelta, assertCashHookSafety,
  assertCashAttemptVacant, assertCashBuildManifest, assertCashRuntimeBinding, bynForUsd,
  cashQaEligibleRefs, deriveCashAdvanceObserved, expectedCashQaFinal,
  parseCashRunnerArgs, runCashQaRunner, withCashQaContext } from "./cash-qa-runner.mjs";

const root = "D:\\Projects\\pero_crm_worktrees\\manager-cash-advances";
const cwd = `${root}\\apps\\web`;
const source = { platform: "win32", root, cwd, head: "3f6da0da082cc707370346c9c3a458ba24d1c189",
  sqlSha: "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd", env: {} };

test("source guard rejects another checkout, revision, SQL or ambient DB override before any runtime dependency", () => {
  assert.equal(assertCashQaSource(source), true);
  assert.throws(() => assertCashQaSource({ ...source, root: "D:\\Projects\\pero_crm_v2" }), /SOURCE_WORKTREE_FORBIDDEN/);
  assert.throws(() => assertCashQaSource({ ...source, head: "deadbeef" }), /SOURCE_REVISION_MISMATCH/);
  assert.throws(() => assertCashQaSource({ ...source, sqlSha: "0".repeat(64) }), /SQL_SHA_MISMATCH/);
  assert.throws(() => assertCashQaSource({ ...source, env: { DATABASE_URL: "postgresql://prod" } }), /AMBIENT_OVERRIDE_FORBIDDEN/);
});

function snapshot() {
  const tables = cashQaSchemaTables();
  const rows = Object.fromEntries(tables.map((table) => [table, [] as string[]]));
  rows.Plugin = [JSON.stringify({ id: "demo", enabled: false, version: "0.1.0", updatedAt: "2026-09-29T00:00:00" }),
    JSON.stringify({ id: "file-stages", enabled: true, version: "0.1.0", updatedAt: "2026-09-29T00:00:00" })];
  return { schemaTables: tables, schemaHash: "a".repeat(64), rows };
}

test("startup gate permits only known Plugin.updatedAt drift, never business or plugin-run changes", () => {
  const before = snapshot(), after = structuredClone(before);
  after.rows.Plugin = after.rows.Plugin.map((raw: string) => JSON.stringify({ ...JSON.parse(raw), updatedAt: "2026-09-29T00:01:00" }));
  const receipt = { runId: randomUUID(), schemaHash: before.schemaHash, schemaTables: before.schemaTables,
    fingerprints: cashRawFingerprints(before, before.schemaTables), pluginRows: before.rows.Plugin };
  assert.equal(assertCashStartupDelta(receipt, after).allowedPluginOnly, true);
  const business = structuredClone(after);
  business.rows.Client = [JSON.stringify({ id: "foreign", name: "Changed" })];
  assert.throws(() => assertCashStartupDelta(receipt, business), /STARTUP_BUSINESS_DRIFT/);
  const pluginRun = structuredClone(after);
  pluginRun.rows.PluginRunLog = [JSON.stringify({ id: "unexpected" })];
  assert.throws(() => assertCashStartupDelta(receipt, pluginRun), /STARTUP_BUSINESS_DRIFT/);
  const changedPlugin = structuredClone(after);
  changedPlugin.rows.Plugin[0] = JSON.stringify({ ...JSON.parse(changedPlugin.rows.Plugin[0]), enabled: true });
  assert.throws(() => assertCashStartupDelta(receipt, changedPlugin), /STARTUP_PLUGIN_DRIFT/);
});

test("enabled demo hook blocks unowned payroll event effects; file-stages alone is safe", () => {
  assert.equal(assertCashHookSafety(snapshot()), true);
  const unsafe = snapshot();
  unsafe.rows.Plugin[0] = JSON.stringify({ ...JSON.parse(unsafe.rows.Plugin[0]), enabled: true });
  assert.throws(() => assertCashHookSafety(unsafe), /UNATTRIBUTABLE_PLUGIN_HOOK/);
});

test("read-only refs include IDs and roles for eligible active actors and existing clients only", () => {
  const source = snapshot();
  source.rows.User = [
    JSON.stringify({ id: "manager", active: true, roles: ["MANAGER"] }),
    JSON.stringify({ id: "finance", active: true, roles: ["ACCOUNTANT"] }),
    JSON.stringify({ id: "inactive", active: false, roles: ["DIRECTOR"] }),
    JSON.stringify({ id: "worker", active: true, roles: ["WORKER"] }),
  ];
  source.rows.Client = [JSON.stringify({ id: "client", name: "Private real client" })];
  assert.deepEqual(cashQaEligibleRefs(source), { managers: [{ id: "manager", roles: ["MANAGER"] }],
    finance: [{ id: "finance", roles: ["ACCOUNTANT"] }], clientIds: ["client"] });
});

test("one-shot prepare and cleanup refuse both prior intent and orphaned result proofs", () => {
  assert.equal(assertCashAttemptVacant([], "prepare"), true);
  assert.throws(() => assertCashAttemptVacant(["prepare-intent.json"], "prepare"), /PRIOR_WRITE_ATTEMPT/);
  assert.throws(() => assertCashAttemptVacant(["prepared.json.sha.json"], "prepare"), /PRIOR_WRITE_ATTEMPT/);
  assert.throws(() => assertCashAttemptVacant(["cleanup-intent.json.sha.json"], "cleanup"), /PRIOR_WRITE_ATTEMPT/);
  assert.throws(() => assertCashAttemptVacant(["cleaned.json"], "cleanup"), /PRIOR_WRITE_ATTEMPT/);
});

test("USD funding snapshot uses decimal half-up arithmetic without binary floating drift", () => {
  assert.equal(bynForUsd("3.111100"), "3111.10");
  assert.equal(bynForUsd("0.000005"), "0.01");
  assert.throws(() => bynForUsd("Infinity"), /FX_RATE_INVALID/);
});

test("final expected balances are plan arithmetic, independent of the observed snapshot", () => {
  assert.deepEqual(expectedCashQaFinal({ mode: "USD", fxProof: { rate: "3.025700" } }),
    { bynCash: "680.00", usdCash: "950.00", inactiveDue: "300.00", orgDeltaByn: "3554.41" });
  assert.deepEqual(expectedCashQaFinal({ mode: "USD", fxProof: { rate: "3.025700" } }, true),
    { bynCash: "680.00", usdCash: "1000.00", inactiveDue: "300.00", orgDeltaByn: "3705.70" });
  assert.deepEqual(expectedCashQaFinal({ mode: "BYN_FALLBACK" }),
    { bynCash: "1680.00", usdCash: "0.00", inactiveDue: "300.00", orgDeltaByn: "1680.00" });
});

test("runtime receipt binds exact build, migration and secret, and compiled cash actions", () => {
  const build = { head: source.head, buildId: "reviewed" };
  const prestart = { migrationReceiptSha256: "a".repeat(64) };
  const secret = { digest: "b".repeat(64) };
  const started = { origin: "http://127.0.0.1:3106", pid: 1234, build,
    migrationReceiptSha256: prestart.migrationReceiptSha256, secretDigest: secret.digest };
  assert.equal(assertCashRuntimeBinding(started, build, prestart, secret, false), true);
  assert.throws(() => assertCashRuntimeBinding(started, build, prestart, secret, true), /RUNTIME_RECEIPT_MISMATCH/);
  assert.throws(() => assertCashRuntimeBinding(started, { ...build, buildId: "stale" }, prestart, secret, false),
    /RUNTIME_RECEIPT_MISMATCH/);
  const node = Object.fromEntries(["issueAdvance", "previewCashPayout"].map((exportedName, index) =>
    [String(index + 1).repeat(42), { exportedName,
      filename: "D:/Projects/pero_crm_worktrees/manager-cash-advances/apps/web/src/server/payroll/cash-actions.ts" }]));
  assert.equal(assertCashBuildManifest({ node }), true);
  assert.throws(() => assertCashBuildManifest({ node: { ...node, ["1".repeat(42)]:
    { ...node["1".repeat(42)], filename: "/foreign/issueAdvance.ts" } } }), /BUILD_ACTIONS_OR_SOURCE_MISMATCH/);
});

test("async QA operation keeps Prisma connected until delayed read-only work finishes", async () => {
  const calls: string[] = [];
  let release!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { release = resolve; });
  const context = { prisma: { $disconnect: async () => { calls.push("disconnect"); } } };
  const work = withCashQaContext(context, async () => { calls.push("begin");
    const value = await pending; calls.push("end"); return value; });
  await Promise.resolve();
  assert.deepEqual(calls, ["begin"]);
  release("snapshot-complete");
  assert.equal(await work, "snapshot-complete");
  assert.deepEqual(calls, ["begin", "end", "disconnect"]);
});

test("advance capture derives effects only from reserved request and action payout ID", () => {
  const requestId = randomUUID(), payoutId = randomUUID(), runId = randomUUID();
  const plan = { runId, requestIds: { advance: requestId }, actors: { managerId: "manager", financeRecipientIds: ["finance"] },
    users: [{ id: "payee" }] };
  const browser = { status: "FORM_ADVANCE_CREATED", runId, captured: { requestId, payoutId } };
  const state = { rows: {
    ChangeLog: [JSON.stringify({ id: `payout-issue:${requestId}`, entityId: payoutId, actorId: "manager",
      newValue: { kind: "ADVANCE", userId: "payee" } })],
    DomainEvent: [JSON.stringify({ id: "event", type: "payroll.payout", actor: "manager", payload: { payoutId } })],
    Notification: [JSON.stringify({ id: "personal", type: "payroll.payout", userId: "payee",
      body: `QA-CASH ${runId} advance` }), JSON.stringify({ id: "org", type: "payroll.orgPayout", userId: "finance",
      body: `QA-CASH ${runId} advance` })],
  } };
  assert.deepEqual(deriveCashAdvanceObserved(state, plan, browser).effectIds,
    { DomainEvent: ["event"], Notification: ["personal", "org"], ChangeLog: [] });
  assert.throws(() => deriveCashAdvanceObserved(state, plan, { ...browser, captured: { requestId, payoutId: "foreign" } }),
    /ADVANCE_RECEIPT_MISMATCH/);
  const foreign = structuredClone(state);
  foreign.rows.Notification[1] = JSON.stringify({ id: "org", type: "payroll.orgPayout", userId: "finance",
    body: "Unrelated salary notification" });
  assert.throws(() => deriveCashAdvanceObserved(foreign, plan, browser), /ADVANCE_NOTIFICATION_MISMATCH/);
});

test("CLI is dry-run by default and binds exact operations without touching injected runtime", async () => {
  assert.deepEqual(parseCashRunnerArgs([]), { operation: "dry-run", paths: [] });
  assert.deepEqual(parseCashRunnerArgs(["prestart", "C:\\Temp\\receipt.json"]),
    { operation: "prestart", paths: ["C:\\Temp\\receipt.json"] });
  assert.deepEqual(parseCashRunnerArgs(["refs-local", "receipt", "prestart"]),
    { operation: "refs-local", paths: ["receipt", "prestart"] });
  assert.deepEqual(parseCashRunnerArgs(["browser-local", "receipt", "plan", "approval", "prestart", "initial"]),
    { operation: "browser-local", paths: ["receipt", "plan", "approval", "prestart", "initial"] });
  assert.deepEqual(parseCashRunnerArgs(["diagnose-plan-local", "receipt", "prestart", "selection", "USD"]),
    { operation: "diagnose-plan-local", paths: ["receipt", "prestart", "selection", "USD"] });
  assert.deepEqual(parseCashRunnerArgs(["fx-preview-local", "receipt", "plan", "approval"]),
    { operation: "fx-preview-local", paths: ["receipt", "plan", "approval"] });
  assert.throws(() => parseCashRunnerArgs(["prepare", "plan.json"]), /RUNNER_USAGE_INVALID/);
  assert.throws(() => parseCashRunnerArgs(["production"]), /RUNNER_USAGE_INVALID/);
  const forbidden = new Proxy({}, { get: () => { throw new Error("RUNTIME_TOUCHED"); } });
  assert.equal((await runCashQaRunner({ args: [], runtime: forbidden as never }) as { status: string }).status, "DRY_RUN");
});
