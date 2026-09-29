/** Root opt-in stage transport; import never opens SSH, DB or browser. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cashCaptureSha256, cashPlanSha256, validateCashQaPlan } from "./cash-owned-fixtures.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), ".."), ROOT = resolve(WEB, "../..");
const ENTRY = join(WEB, "tests", "cash-stage-entry.mjs");
const WRAPPER = join(ROOT, "deploy", "acceptance", "cash-staging-qa.py");
const WINDOW = join(ROOT, "deploy", "acceptance", "engineering-staging-window.py");
const PREFIX = "pero-cash-qa-staging-";
const HEAD = "3f6da0da082cc707370346c9c3a458ba24d1c189";
const SQL_SHA = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd";
const SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790";
const RUN_ID = "8d7055e1-560a-4c0d-969a-b2f6193deaa2";
const REQUIRE = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const check = (ok, code) => { if (!ok) throw new Error(code); };
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

export function validateCashStageSeal(seal) {
  const fields = ["wrapperSha256", "bundleSha256", "entrySha256", "runnerSha256", "windowSha256",
    "supportSha256", "backupReceiptSha256"];
  check(seal?.format === "pero-cash-stage-seal/v1" && seal.sealedBy === "root" &&
    seal.expectedRevision === HEAD &&
    seal.supportSha256 === SUPPORT_SHA && seal.backupRunId === "667367d7-83e5-40f1-b06b-b57889170685" &&
    fields.every((key) => /^[0-9a-f]{64}$/.test(seal[key] ?? "")) &&
    seal.backupReceiptSha256 === "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e",
  "CASH_STAGE_SEAL_INVALID");
  return seal;
}

function safeEnv() {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "ssh_auth_sock", "username", "userdomain", "programdata"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}
function sourceGuard() {
  check(process.platform === "win32" && realpathSync(ROOT).toLowerCase() ===
    "d:\\projects\\pero_crm_worktrees\\manager-cash-advances" &&
    realpathSync(process.cwd()).toLowerCase() === realpathSync(WEB).toLowerCase(), "CASH_STAGE_WORKTREE_REQUIRED");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DATABASE_URL", "DIRECT_URL", "DOCKER_HOST", "DOCKER_CONFIG",
    "PYTHONPATH", "DOTENV_CONFIG_PATH"]) check(!process.env[key], "CASH_STAGE_AMBIENT_OVERRIDE_FORBIDDEN");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, env: safeEnv(), windowsHide: true,
    encoding: "utf8" }).trim();
  const runtimePaths = ["apps/web/src", "apps/web/prisma", "apps/web/package.json", "pnpm-lock.yaml",
    "apps/web/next.config.ts", "apps/web/next.config.mjs", "apps/web/next.config.js"];
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", ...runtimePaths],
    { cwd: ROOT, env: safeEnv(), windowsHide: true, encoding: "utf8" }).trim();
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...runtimePaths],
    { cwd: ROOT, env: safeEnv(), windowsHide: true, encoding: "utf8" }).trim();
  check(head === HEAD && sha(readFileSync(join(WEB, "prisma", "migrations",
    "20260929120000_manager_cash_advances", "migration.sql"))) === SQL_SHA && !changed && !untracked,
  "CASH_STAGE_SOURCE_MISMATCH");
}
function save(directory, name, value) {
  const file = join(directory, name), bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + "\n"),
    fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "CASH_STAGE_READBACK_FAILED");
  return file;
}
function stateDir(input) {
  check(typeof input === "string" && isAbsolute(input) && existsSync(input) && lstatSync(input).isDirectory() &&
    !lstatSync(input).isSymbolicLink(), "CASH_STAGE_STATE_REQUIRED");
  const dir = realpathSync(input);
  check(dirname(dir).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    dir.split(/[\\/]/).at(-1).startsWith(PREFIX), "CASH_STAGE_STATE_FORBIDDEN");
  return dir;
}
function privateDir() {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  const who = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"],
    { encoding: "utf8", windowsHide: true, env: safeEnv() });
  const sid = who.match(/S-1-\d+(?:-\d+)+/g);
  check(sid?.length === 1, "CASH_STAGE_OWNER_REQUIRED");
  execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`,
    "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], { windowsHide: true, env: safeEnv(), stdio: "pipe" });
  return directory;
}

export async function buildCashStageBundle() {
  const { build } = createRequire(REQUIRE.resolve("tsx/package.json"))("esbuild");
  const output = await build({ entryPoints: [ENTRY], bundle: true, write: false, platform: "node", format: "esm",
    target: "node22", external: ["@prisma/client", "@node-rs/argon2"], logLevel: "silent" });
  check(output.outputFiles.length === 1 && output.outputFiles[0].contents.length <= 768 * 1024, "CASH_STAGE_BUNDLE_INVALID");
  return Buffer.from(output.outputFiles[0].contents);
}
async function reviewed(seal) {
  sourceGuard(); validateCashStageSeal(seal);
  const bundle = await buildCashStageBundle();
  check(sha(readFileSync(SELF)) === seal.runnerSha256 && sha(readFileSync(ENTRY)) === seal.entrySha256 &&
    sha(readFileSync(WRAPPER)) === seal.wrapperSha256 && sha(readFileSync(WINDOW)) === seal.windowSha256 &&
    sha(bundle) === seal.bundleSha256,
  "CASH_STAGE_REVIEWED_SOURCE_CHANGED");
  return bundle;
}

/** Root invokes this only after reviewing exact source/backup/deployment scope. No remote access. */
export async function createCashStageSeal() {
  sourceGuard();
  const bundle = await buildCashStageBundle();
  const seal = { format: "pero-cash-stage-seal/v1", sealedBy: "root", expectedRevision: HEAD,
    wrapperSha256: sha(readFileSync(WRAPPER)), bundleSha256: sha(bundle),
    entrySha256: sha(readFileSync(ENTRY)), runnerSha256: sha(readFileSync(SELF)),
    windowSha256: sha(readFileSync(WINDOW)), supportSha256: SUPPORT_SHA,
    backupReceiptSha256: "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e",
    backupRunId: "667367d7-83e5-40f1-b06b-b57889170685" };
  validateCashStageSeal(seal);
  const directory = privateDir(), sealFile = save(directory, "seal.json", seal);
  return { status: "SEAL_SAVED_REVIEW_REQUIRED", sealFile, directory, bundleBytes: bundle.length,
    wrapperSha256: seal.wrapperSha256, bundleSha256: seal.bundleSha256, windowSha256: seal.windowSha256 };
}
function sshBinary() {
  const file = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
  check(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink() &&
    realpathSync(file).toLowerCase() === file.toLowerCase(), "WINDOWS_SSH_IDENTITY_REQUIRED");
  return file;
}
async function transport(directory, packet, bundle) {
  const wire = Buffer.from(JSON.stringify({ ...packet, bundle: bundle.toString("base64") }));
  check(wire.length <= 2 * 1024 * 1024, "CASH_STAGE_PACKET_TOO_LARGE");
  const remote = `/root/pero-cash-qa-${packet.seal.wrapperSha256}.py`;
  const output = [], errors = []; let outSize = 0, errSize = 0;
  const exit = await new Promise((resolveExit) => {
    const child = spawn(sshBinary(), ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "crm-staging", "python3", remote], { windowsHide: true, env: safeEnv(), stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { outSize += chunk.length; if (outSize <= 2 * 1024 * 1024) output.push(chunk); });
    child.stderr.on("data", (chunk) => { errSize += chunk.length; if (errSize <= 128 * 1024) errors.push(chunk); });
    child.stdin.on("error", () => {});
    child.once("error", () => resolveExit(null)); child.once("close", resolveExit);
    child.stdin.end(wire);
  });
  if (packet.operation !== "sessions") {
    save(directory, `${packet.operation}-${packet.attemptId}-stdout.bin`, Buffer.concat(output));
    save(directory, `${packet.operation}-${packet.attemptId}-stderr.bin`, Buffer.concat(errors));
  }
  check(exit === 0 && outSize <= 2 * 1024 * 1024 && errSize <= 128 * 1024,
    "CASH_STAGE_SSH_OUTCOME_UNKNOWN_INSPECT");
  let body;
  try { body = JSON.parse(Buffer.concat(output).toString("utf8")); }
  catch { throw new Error("CASH_STAGE_JSON_UNKNOWN_INSPECT"); }
  check(body.attemptId === packet.attemptId && body.operation === packet.operation &&
    body.identity?.hostname === "crm-staging" && body.identity.revision === packet.seal.expectedRevision &&
    body.result?.publicSummary?.status === "PASS" && body.result.publicSummary.operation === packet.operation,
  body.publicSummary?.code ?? "CASH_STAGE_RESPONSE_INVALID_INSPECT");
  return body.result;
}
async function send(directory, operation, input, runId = null) {
  const seal = validateCashStageSeal(read(join(directory, "control.json")).seal), bundle = await reviewed(seal);
  const packet = { seal, operation, attemptId: randomUUID(), runId,
    input: { operation, target: "staging", ...input } };
  return transport(directory, packet, bundle);
}

export async function cashStageInit(sealFile) {
  sourceGuard();
  check(isAbsolute(sealFile) && lstatSync(sealFile).isFile() && !lstatSync(sealFile).isSymbolicLink(),
    "CASH_STAGE_ROOT_SEAL_REQUIRED");
  const seal = validateCashStageSeal(read(sealFile)); await reviewed(seal);
  const directory = privateDir(); save(directory, "control.json", { seal, target: "staging" });
  const result = await send(directory, "refs", {});
  save(directory, "refs.json", result.privatePayload);
  return { status: "REFS_SAVED", directory, refs: result.privatePayload };
}

export async function cashStageOperation({ operation, directory, managerId, financeId, clientId, mode,
  expectedPlanSha256, observed, phase, captureName, captured, durableCaptureSha256, actionsDrained,
  abortEvidence, kind } = {}) {
  sourceGuard(); const dir = stateDir(directory);
  check(["plan", "approve", "prepare", "capture", "verify", "observe", "cleanup", "abort-cleanup", "sessions"].includes(operation),
    "CASH_STAGE_OPERATION_FORBIDDEN");
  if (operation === "plan") {
    check(!existsSync(join(dir, "plan.json")), "CASH_STAGE_PLAN_ALREADY_EXISTS");
    const result = await send(dir, "plan", { managerId, financeId, clientId, mode });
    const plan = validateCashQaPlan(result.privatePayload);
    check(plan.runId === RUN_ID && plan.target.kind === "EXISTING_STAGING", "CASH_STAGE_PLAN_MISMATCH");
    save(dir, "plan.json", plan); save(dir, "plan-sha256.json", { sha256: cashPlanSha256(plan) });
    return { status: "PLAN_SAVED_REVIEW_REQUIRED", directory: dir, planSha256: cashPlanSha256(plan) };
  }
  const plan = validateCashQaPlan(read(join(dir, "plan.json")));
  const digest = cashPlanSha256(plan);
  check(plan.runId === RUN_ID && read(join(dir, "plan-sha256.json")).sha256 === digest, "CASH_STAGE_PLAN_DRIFT");
  if (operation === "approve") {
    check(expectedPlanSha256 === digest, "CASH_STAGE_PLAN_REVIEW_HASH_MISMATCH");
    const approval = { source: "owner-reviewed", planSha256: digest, sqlSha256: SQL_SHA,
      targetKind: "EXISTING_STAGING", approvedAt: new Date().toISOString() };
    return { status: "APPROVAL_SAVED", approvalFile: save(dir, "approval.json", approval) };
  }
  const approval = read(join(dir, "approval.json"));
  check(approval.source === "owner-reviewed" && approval.planSha256 === digest &&
    approval.sqlSha256 === SQL_SHA && approval.targetKind === "EXISTING_STAGING", "CASH_STAGE_APPROVAL_DRIFT");
  if (operation === "sessions") {
    check(existsSync(join(dir, "prepared.json")), "CASH_STAGE_FIXTURES_NOT_PREPARED");
    const result = await send(dir, "sessions", { plan, approval }, RUN_ID);
    return result.privatePayload; // cookies and compiled action IDs stay in caller memory
  }
  if (operation === "prepare") {
    check(!existsSync(join(dir, "prepare-intent.json")) && !existsSync(join(dir, "prepared.json")),
      "CASH_STAGE_PREPARE_ALREADY_ATTEMPTED");
    save(dir, "prepare-intent.json", { runId: RUN_ID, planSha256: digest, at: new Date().toISOString() });
    const result = await send(dir, "prepare", { plan, approval }, RUN_ID);
    save(dir, "prepared.json", result.privatePayload);
    save(dir, "observed-initial.json", { outcomes: [], effectIds: {} });
    return { status: "PREPARED", phase: result.privatePayload.phase, runId: RUN_ID };
  }
  if (operation === "capture") {
    check(["INITIAL", "PARTIAL", "FINAL"].includes(phase) &&
      /^[a-z][a-z0-9-]{0,40}$/.test(captureName ?? "") && observed &&
      !existsSync(join(dir, `captured-${captureName}.json`)), "CASH_STAGE_CAPTURE_INPUT_INVALID");
    const result = await send(dir, "capture", { plan, approval, observed, phase }, RUN_ID);
    save(dir, `captured-${captureName}.json`, result.privatePayload);
    return { status: "CAPTURED", captureName, phase, graphHash: result.privatePayload.graphHash };
  }
  if (operation === "verify") {
    check(/^[a-z][a-z0-9-]{0,40}$/.test(captureName ?? ""), "CASH_STAGE_VERIFY_NAME_INVALID");
    const priorObserved = read(join(dir, `observed-${captureName}.json`));
    const priorCaptured = read(join(dir, `captured-${captureName}.json`));
    const result = await send(dir, "verify", { plan, approval, observed: priorObserved,
      captured: priorCaptured }, RUN_ID);
    check(result.privatePayload.sameAsPrior === true && result.privatePayload.graphHash === priorCaptured.graphHash,
      "CASH_STAGE_VERIFY_DRIFT");
    const evidenceFile = save(dir, `verified-${captureName}-${randomUUID()}.json`, result.privatePayload);
    return { status: "PRIOR_CAPTURE_MATCH", captureName, graphHash: priorCaptured.graphHash, evidenceFile };
  }
  if (operation === "observe") {
    const preceding = { advance: "initial", salary200: "advance", usd50: "salary200", delete10: "usd50",
      remove10: "delete10", replay10: "remove10" }[kind];
    check(preceding && !existsSync(join(dir, `observed-${kind}.json`)) &&
      existsSync(join(dir, `captured-${preceding}.json`)), "CASH_STAGE_OBSERVE_ORDER_INVALID");
    const priorObserved = read(join(dir, `observed-${preceding}.json`));
    const resultFile = kind === "advance" ? "cash-browser-result.json" : `${kind}-result.json`;
    const actionResult = read(join(dir, resultFile));
    check(kind !== "advance" || actionResult.status === "FORM_ADVANCE_CREATED", "CASH_STAGE_FORM_RESULT_REQUIRED");
    const output = await send(dir, "observe", { plan, approval, kind, priorObserved, actionResult }, RUN_ID);
    check(output.privatePayload?.captured?.phase === (kind === "replay10" ? "FINAL" : "PARTIAL"),
      "CASH_STAGE_OBSERVE_PHASE_MISMATCH");
    save(dir, `observed-${kind}.json`, output.privatePayload.observed);
    save(dir, `captured-${kind}.json`, output.privatePayload.captured);
    if (kind === "replay10") {
      save(dir, "observed-final.json", output.privatePayload.observed);
      save(dir, "captured-final.json", output.privatePayload.captured);
      const kinds = ["salary200", "usd50", "delete10", "remove10", "replay10"];
      check(kinds.every((step) => existsSync(join(dir, `${step}-intent.json`)) &&
        existsSync(join(dir, `${step}-result.json`)) &&
        read(join(dir, `${step}-result.json`)).status === "ACTION_RESPONSE_CAPTURED"),
      "CASH_STAGE_REMAINING_ACTIONS_NOT_DRAINED");
      for (const name of readdirSync(dir).filter((item) => /^window-[0-9a-f-]{36}-acquired\.json$/.test(item))) {
        const ended = read(join(dir, name.replace("-acquired.json", "-ended.json")));
        check(ended.released === true && ended.code === 0 && ended.failed === false,
          "CASH_STAGE_WINDOW_NOT_DRAINED");
      }
      save(dir, "remaining-drained.json", { runId: RUN_ID, actionsDrained: true,
        capturedGraphHash: output.privatePayload.captured.graphHash, kinds });
    }
    return { status: "OBSERVED", kind, phase: output.privatePayload.captured.phase,
      graphHash: output.privatePayload.captured.graphHash };
  }
  if (operation === "abort-cleanup") {
    check(["INITIAL", "PARTIAL"].includes(captured?.phase) && observed &&
      durableCaptureSha256 === cashCaptureSha256(captured) &&
      abortEvidence?.source === "root-reviewed-abort-drain" && abortEvidence.runId === RUN_ID &&
      abortEvidence.graphHash === captured.graphHash && abortEvidence.actionsDrained === true &&
      abortEvidence.uncertainInspected === true && !existsSync(join(dir, "abort-cleanup-intent.json")),
    "CASH_STAGE_ABORT_PROOF_REQUIRED");
    const browserStarted = existsSync(join(dir, "cash-browser-started.json"));
    if (browserStarted) {
      const drained = read(join(dir, "cash-browser-drained.json"));
      check(drained.runId === RUN_ID && drained.actionsDrained === true && drained.contextsClosed === true,
        "CASH_STAGE_BROWSER_NOT_DRAINED");
    } else check(captured.phase === "INITIAL" && observed.outcomes?.length === 0,
      "CASH_STAGE_ABORT_UNKNOWN_ACTIONS");
    const abortApproval = { source: "root-reviewed-abort", planSha256: digest,
      captureSha256: durableCaptureSha256, graphHash: captured.graphHash, uncertainInspected: true,
      phase: captured.phase, at: new Date().toISOString() };
    save(dir, "abort-approval.json", abortApproval);
    save(dir, "abort-cleanup-intent.json", { runId: RUN_ID, graphHash: captured.graphHash,
      phase: captured.phase, at: new Date().toISOString() });
    const result = await send(dir, "abort-cleanup", { plan, approval, observed, captured,
      durableCaptureSha256, actionsDrained: true, abortApproval }, RUN_ID);
    save(dir, "abort-cleaned.json", result.privatePayload);
    return { status: "ABORT_CLEANED_NO_FINAL_ACCEPTANCE", deleted: result.privatePayload.deleted };
  }
  check(captured?.phase === "FINAL" && durableCaptureSha256 && actionsDrained === true &&
    !existsSync(join(dir, "cleanup-intent.json")), "CASH_STAGE_CLEANUP_PROOF_REQUIRED");
  save(dir, "cleanup-intent.json", { runId: RUN_ID, graphHash: captured.graphHash, at: new Date().toISOString() });
  const result = await send(dir, "cleanup", { plan, approval, observed, captured,
    durableCaptureSha256, actionsDrained: true }, RUN_ID);
  save(dir, "cleaned.json", result.privatePayload);
  return { status: "CLEANED", deleted: result.privatePayload.deleted };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SELF).toLowerCase()) {
  void (async () => {
    const [operation, first, second, third, fourth, fifth, ...extra] = process.argv.slice(2);
    check(!extra.length, "CASH_STAGE_USAGE_INVALID");
    if (operation === "seal") { check(first === undefined, "CASH_STAGE_USAGE_INVALID");
      return createCashStageSeal(); }
    if (operation === "init") { check(first && !second, "CASH_STAGE_USAGE_INVALID"); return cashStageInit(first); }
    if (operation === "plan") {
      check(first && second && third && fourth && fifth, "CASH_STAGE_USAGE_INVALID");
      return cashStageOperation({ operation, directory: first, managerId: second, financeId: third,
        clientId: fourth, mode: fifth });
    }
    if (operation === "approve") {
      check(first && second && !third, "CASH_STAGE_USAGE_INVALID");
      return cashStageOperation({ operation, directory: first, expectedPlanSha256: second });
    }
    if (operation === "prepare") { check(first && !second, "CASH_STAGE_USAGE_INVALID");
      return cashStageOperation({ operation, directory: first }); }
    if (operation === "capture") {
      check(first && second && !third && /^[a-z][a-z0-9-]{0,40}$/.test(second), "CASH_STAGE_USAGE_INVALID");
      const dir = stateDir(first), file = join(dir, `observed-${second}.json`);
      check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),
        "CASH_STAGE_OBSERVED_PATH_FORBIDDEN");
      const phase = second === "initial" ? "INITIAL" : second === "final" ? "FINAL" : "PARTIAL";
      return cashStageOperation({ operation, directory: dir, observed: read(file), phase, captureName: second });
    }
    if (operation === "observe") {
      check(first && second && !third, "CASH_STAGE_USAGE_INVALID");
      return cashStageOperation({ operation, directory: first, kind: second });
    }
    if (operation === "verify") {
      check(first && second && !third, "CASH_STAGE_USAGE_INVALID");
      return cashStageOperation({ operation, directory: first, captureName: second });
    }
    if (operation === "cleanup") {
      check(first && !second, "CASH_STAGE_USAGE_INVALID");
      const dir = stateDir(first), observed = read(join(dir, "observed-final.json")),
        captured = read(join(dir, "captured-final.json")), browser = read(join(dir, "cash-browser-drained.json")),
        remaining = read(join(dir, "remaining-drained.json"));
      check(browser.actionsDrained === true && browser.contextsClosed === true && browser.runId === RUN_ID &&
        remaining.actionsDrained === true && remaining.runId === RUN_ID &&
        remaining.capturedGraphHash === captured.graphHash, "CASH_STAGE_ACTIONS_NOT_DRAINED");
      return cashStageOperation({ operation, directory: dir, observed, captured,
        durableCaptureSha256: cashCaptureSha256(captured), actionsDrained: true });
    }
    if (operation === "abort-cleanup") {
      check(first && second && third && !fourth && /^[a-z][a-z0-9-]{0,40}$/.test(second), "CASH_STAGE_USAGE_INVALID");
      const dir = stateDir(first), observed = read(join(dir, `observed-${second}.json`)),
        captured = read(join(dir, `captured-${second}.json`)), abortEvidence = read(join(dir, "abort-drained.json"));
      check(third === cashCaptureSha256(captured), "CASH_STAGE_ABORT_CAPTURE_HASH_MISMATCH");
      return cashStageOperation({ operation, directory: dir, observed, captured,
        durableCaptureSha256: third, abortEvidence });
    }
    check(false, "CASH_STAGE_USAGE_INVALID");
  })().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    const code = error instanceof Error ? error.message : "";
    process.stderr.write(`${JSON.stringify({ status: "STOP", code: /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code :
      "CASH_STAGE_FAILED_INSPECT" })}\n`);
    process.exitCode = 1;
  });
}
