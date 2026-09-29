/** Stage browser coordinator. Import never opens SSH/browser; no HANDOVER file access. */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync,
  realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { cashStageOperation, validateCashStageSeal } from "./cash-stage-runner.mjs";
import { cashActionIds, cashActionOutcome, cashAuthCookieHeader, runCashQaBrowser,
  validateCashBrowserBinding } from "./cash-qa-browser.mjs";
import { cashDeleteIntent, cashRemainingIntent } from "./cash-local-actions.mjs";
import { cashRemainingPredecessor } from "./cash-local-progress.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), ".."), ROOT = resolve(WEB, "../..");
const WINDOW = join(ROOT, "deploy", "acceptance", "engineering-staging-window.py");
const RUN_ID = "8d7055e1-560a-4c0d-969a-b2f6193deaa2";
const STAGE = "https://staging-crm.peromebel.by";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const check = (ok, code) => { if (!ok) throw new Error(code); };
async function bounded(promise, milliseconds, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
function safeEnv() {
  const names = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "ssh_auth_sock", "username", "userdomain", "programdata"]);
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => names.has(name.toLowerCase())));
}
function privateDir(path) {
  check(typeof path === "string" && existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(),
    "CASH_STAGE_PRIVATE_DIR_REQUIRED");
  const dir = realpathSync(path);
  check(dirname(dir).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    dir.split(/[\\/]/).at(-1).startsWith("pero-cash-qa-staging-"), "CASH_STAGE_PRIVATE_DIR_FORBIDDEN");
  return dir;
}
function readState(dir, name) {
  const file = join(dir, name);
  check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "CASH_STAGE_STATE_FILE_REQUIRED");
  return JSON.parse(readFileSync(file, "utf8"));
}
function save(dir, name, value) {
  const file = join(dir, name), bytes = Buffer.from(JSON.stringify(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "CASH_STAGE_READBACK_FAILED");
}
function sshBinary() {
  const path = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
  check(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
    realpathSync(path).toLowerCase() === path.toLowerCase(), "WINDOWS_SSH_IDENTITY_REQUIRED");
  return path;
}

export function assertCashStageUsdQuote(plan, outcome) {
  check(plan?.mode === "USD" && outcome?.ok === true && outcome.preview?.cashCurrency === "USD" &&
    outcome.preview.cashAmount === "50.00" && outcome.preview.cashRate === plan.fxProof?.rate &&
    outcome.preview.cashRateDate === plan.fxProof?.date && outcome.preview.payrollCurrency === "BYN",
  "CASH_STAGE_USD_PREVIEW_RATE_DRIFT");
  return outcome.preview;
}

/** W07-held window, exact reviewed revision and remote helper; no service control. */
export async function withCashStageWindow(directory, revision, windowSha256, operation) {
  const dir = privateDir(directory);
  check(/^[0-9a-f]{40}$/.test(revision) && sha(readFileSync(WINDOW)) === windowSha256,
    "CASH_STAGE_WINDOW_SOURCE_MISMATCH");
  for (const name of readdirSync(dir).filter((item) => /^window-[0-9a-f-]{36}-acquired\.json$/.test(item))) {
    const ended = join(dir, name.replace("-acquired.json", "-ended.json"));
    const proof = existsSync(ended) ? readState(dir, name.replace("-acquired.json", "-ended.json")) : null;
    check(proof?.runId === RUN_ID && proof.released === true && proof.code === 0 && proof.failed === false,
      "CASH_STAGE_PREVIOUS_WINDOW_UNRESOLVED");
  }
  const attempt = randomUUID(), remote = `/root/pero-engineering-window-${windowSha256}.py`;
  const child = spawn(sshBinary(), ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "crm-staging", "python3", remote], { windowsHide: true, env: safeEnv(), stdio: ["pipe", "pipe", "pipe"] });
  let alive = true, ready = false, released = false, failed = false, tail = "";
  let resolveReady, rejectReady;
  const readyPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise; rejectReady = rejectPromise;
  });
  const exited = new Promise((resolveExit) => {
    child.once("error", () => { alive = false; failed = true; rejectReady(new Error("CASH_STAGE_WINDOW_SSH_FAILED")); resolveExit(null); });
    child.once("exit", (code) => { alive = false; if (!ready) rejectReady(new Error("CASH_STAGE_WINDOW_NOT_READY")); resolveExit(code); });
  });
  child.stdin.on("error", () => { failed = true; });
  child.stderr.on("data", () => { failed = true; });
  child.stdout.on("data", (chunk) => {
    tail += chunk.toString("utf8");
    if (tail.length > 8192) { failed = true; rejectReady(new Error("CASH_STAGE_WINDOW_OUTPUT_INVALID")); return; }
    let end;
    while ((end = tail.indexOf("\n")) !== -1) {
      const line = tail.slice(0, end); tail = tail.slice(end + 1);
      try {
        const state = JSON.parse(line);
        if (state.status === "WINDOW_READY" && state.runId === RUN_ID && state.revision === revision) {
          ready = true; resolveReady();
        } else if (state.status === "WINDOW_RELEASED" && state.runId === RUN_ID) released = true;
        else { failed = true; rejectReady(new Error("CASH_STAGE_WINDOW_GUARD_STOP")); }
      } catch { failed = true; rejectReady(new Error("CASH_STAGE_WINDOW_OUTPUT_INVALID")); }
    }
  });
  child.stdin.write(JSON.stringify({ revision, runId: RUN_ID }) + "\n");
  const startedAt = Date.now();
  const guard = () => check(ready && alive && !failed && Date.now() - startedAt < 600000,
    "CASH_STAGE_WINDOW_LOST");
  try {
    await bounded(readyPromise, 20000, "CASH_STAGE_WINDOW_READY_TIMEOUT");
    guard();
    save(dir, `window-${attempt}-acquired.json`, { runId: RUN_ID, revision, windowSha256,
      at: new Date().toISOString() });
    return await operation(guard);
  } finally {
    if (alive && ready) child.stdin.end(JSON.stringify({ release: RUN_ID }) + "\n");
    else child.stdin.end();
    let code = null;
    try { code = await bounded(exited, 20000, "CASH_STAGE_WINDOW_SHUTDOWN_TIMEOUT"); }
    catch { failed = true; child.kill("SIGTERM"); }
    save(dir, `window-${attempt}-ended.json`, { runId: RUN_ID, released, code, failed, at: new Date().toISOString() });
    check(released && code === 0 && !failed, "CASH_STAGE_WINDOW_END_FAILED");
  }
}

/** One approved form confirmation only. Credentials are root-provided private JSON, never sourced from HANDOVER. */
export async function runCashStageForm(directory) {
  const dir = privateDir(directory), control = readState(dir, "control.json"), seal = validateCashStageSeal(control.seal);
  const plan = readState(dir, "plan.json"), initial = readState(dir, "captured-initial.json");
  check(plan.runId === RUN_ID && initial.phase === "INITIAL" && existsSync(join(dir, "approval.json")) &&
    existsSync(join(dir, "prepared.json")), "CASH_STAGE_FORM_PREFLIGHT_MISSING");
  const auth = readState(dir, "basic-auth.json");
  check(typeof auth.username === "string" && auth.username.length > 0 &&
    typeof auth.password === "string" && auth.password.length > 0, "CASH_STAGE_BASIC_AUTH_REQUIRED");
  await cashStageOperation({ operation: "verify", directory: dir, captureName: "initial" });
  const sessions = await cashStageOperation({ operation: "sessions", directory: dir });
  check(sessions.origin === STAGE && sessions.sessions.length === 2 &&
    sessions.ttlSeconds === 900, "CASH_STAGE_SESSION_BINDING_MISMATCH");
  const result = await withCashStageWindow(dir, seal.expectedRevision, seal.windowSha256,
    (externalGuard) => runCashQaBrowser({ baseUrl: STAGE, plan, sessions,
      serverReferenceManifest: sessions.serverReferenceManifest, outputDir: dir, httpCredentials: auth, externalGuard }));
  return { status: result.status, runId: RUN_ID, captured: result.captured,
    screenshots: result.screenshots, remaining: result.remaining };
}

/** Read-only USD quote under W07; the later USD payout requires this exact saved rate/date. */
export async function runCashStageUsdPreview(directory) {
  const dir = privateDir(directory), seal = validateCashStageSeal(readState(dir, "control.json").seal);
  const plan = readState(dir, "plan.json");
  check(plan.runId === RUN_ID && plan.mode === "USD" &&
    !existsSync(join(dir, "stage-usd-preview-intent.json")), "CASH_STAGE_USD_PREVIEW_ALREADY_ATTEMPTED");
  await cashStageOperation({ operation: "verify", directory: dir, captureName: "salary200" });
  const sessions = await cashStageOperation({ operation: "sessions", directory: dir });
  validateCashBrowserBinding({ baseUrl: STAGE, plan, sessions });
  const auth = readState(dir, "basic-auth.json"), profile = sessions.sessions[0];
  check(auth.username && auth.password && profile.role === "manager", "CASH_STAGE_USD_PREVIEW_ACTOR_INVALID");
  const actionId = cashActionIds(sessions.serverReferenceManifest).previewCashPayout;
  const args = [{ cashAccountId: plan.accounts[1].id, cashAmount: "50.00", expectedCashCurrency: "USD" }];
  const body = JSON.stringify(args);
  save(dir, "stage-usd-preview-intent.json", { runId: RUN_ID, requestSha256: sha(body),
    planRate: plan.fxProof.rate, planDate: plan.fxProof.date, at: new Date().toISOString() });
  const outcome = await withCashStageWindow(dir, seal.expectedRevision, seal.windowSha256, async (externalGuard) => {
    externalGuard();
    let response, bytes;
    try { response = await fetch(`${STAGE}/advances`, { method: "POST", redirect: "manual", cache: "no-store",
      headers: { "Content-Type": "application/json", "Next-Action": actionId, Origin: STAGE,
        Cookie: cashAuthCookieHeader(profile, STAGE),
        Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}` },
      body, signal: AbortSignal.timeout(30000) });
      bytes = Buffer.from(await response.arrayBuffer()); }
    catch { throw new Error("CASH_STAGE_USD_PREVIEW_TRANSPORT_FAILED"); }
    externalGuard();
    check(response.status === 200, "CASH_STAGE_USD_PREVIEW_HTTP_FAILED");
    return cashActionOutcome(bytes);
  });
  const quote = assertCashStageUsdQuote(plan, outcome);
  save(dir, "stage-usd-preview.json", { status: "USD_PREVIEW_MATCH", runId: RUN_ID,
    cashRate: quote.cashRate, cashRateDate: quote.cashRateDate,
    bynAmount: quote.bynAmount, payrollAmount: quote.amount });
  return { status: "USD_PREVIEW_MATCH", bynAmount: quote.bynAmount };
}

/** Exactly one approved direct action inside a fresh W07-held window; no redirect/retry. */
export async function runCashStageRemainingAction(directory, kind) {
  const dir = privateDir(directory), control = readState(dir, "control.json"), seal = validateCashStageSeal(control.seal);
  const plan = readState(dir, "plan.json"), prior = cashRemainingPredecessor(plan, kind);
  if (kind === "usd50") {
    const preview = readState(dir, "stage-usd-preview.json");
    check(preview.status === "USD_PREVIEW_MATCH" && preview.runId === RUN_ID &&
      preview.cashRate === plan.fxProof.rate && preview.cashRateDate === plan.fxProof.date,
    "CASH_STAGE_USD_PREVIEW_REQUIRED");
  }
  check(plan.runId === RUN_ID && plan.target.kind === "EXISTING_STAGING" &&
    !existsSync(join(dir, `${kind}-intent.json`)) && !existsSync(join(dir, `${kind}-result.json`)),
  "CASH_STAGE_ACTION_ALREADY_ATTEMPTED");
  const observed = readState(dir, `observed-${prior}.json`), captured = readState(dir, `captured-${prior}.json`);
  check(["INITIAL", "PARTIAL"].includes(captured.phase) && observed.outcomes?.length >= 0,
    "CASH_STAGE_PRIOR_CAPTURE_REQUIRED");
  await cashStageOperation({ operation: "verify", directory: dir, captureName: prior });
  const auth = readState(dir, "basic-auth.json");
  check(typeof auth.username === "string" && auth.username.length > 0 &&
    typeof auth.password === "string" && auth.password.length > 0, "CASH_STAGE_BASIC_AUTH_REQUIRED");
  const sessions = await cashStageOperation({ operation: "sessions", directory: dir });
  validateCashBrowserBinding({ baseUrl: STAGE, plan, sessions });
  const actionIds = cashActionIds(sessions.serverReferenceManifest);
  const target = observed.outcomes.find((row) => row.requestId === plan.requestIds.delete && !row.deleted);
  const intent = kind === "remove10" ? cashDeleteIntent(target?.payoutId) :
    cashRemainingIntent(plan, kind === "replay10" ? "delete10" : kind, new Date().toISOString().slice(0, 7));
  if (kind === "replay10") intent.kind = "replay10";
  check(intent.role === (kind === "salary200" || kind === "remove10" ? "finance" : "manager") &&
    ["issueAdvance", "addPayout", "deletePayout"].includes(intent.action), "CASH_STAGE_ACTION_ROLE_INVALID");
  const profile = sessions.sessions.find((row) => row.role === intent.role);
  check(profile?.cookie?.domain === "staging-crm.peromebel.by" && profile.cookie.secure === true,
    "CASH_STAGE_COOKIE_SCOPE_INVALID");
  const body = JSON.stringify(intent.args), actionId = actionIds[intent.action], authorization =
    `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
  save(dir, `${kind}-intent.json`, { runId: RUN_ID, kind, actorId: profile.userId,
    requestId: intent.args[0]?.requestId ?? null, payoutId: kind === "remove10" ? intent.args[0] : null,
    payloadSha256: sha(body), priorGraphHash: captured.graphHash, at: new Date().toISOString() });
  const result = await withCashStageWindow(dir, seal.expectedRevision, seal.windowSha256, async (externalGuard) => {
    externalGuard();
    let response, bytes;
    try {
      response = await fetch(`${STAGE}${intent.path}`, { method: "POST", redirect: "manual", cache: "no-store",
        headers: { "Content-Type": "application/json", "Next-Action": actionId, Origin: STAGE,
          Cookie: cashAuthCookieHeader(profile, STAGE), Authorization: authorization },
        body, signal: AbortSignal.timeout(30000) });
      bytes = Buffer.from(await response.arrayBuffer());
    } catch { throw new Error("CASH_STAGE_ACTION_UPSTREAM_UNCERTAIN"); }
    externalGuard();
    check(response.status === 200, "CASH_STAGE_ACTION_HTTP_UNCERTAIN");
    return { outcome: cashActionOutcome(bytes), requestSha256: sha(body), responseSha256: sha(bytes),
      httpStatus: response.status, kind };
  });
  const valid = kind === "replay10" ? result.outcome.ok === false &&
    typeof result.outcome.error === "string" && result.outcome.error.includes("отменена") :
    kind === "remove10" ? result.outcome.ok === true : result.outcome.ok === true &&
      result.outcome.repeated === false && typeof result.outcome.payoutId === "string";
  save(dir, `${kind}-result.json`, { status: valid ? "ACTION_RESPONSE_CAPTURED" :
    "UNEXPECTED_RESPONSE_CAPTURE_REQUIRED", ...result });
  check(valid, "CASH_STAGE_UNEXPECTED_ACTION_RESPONSE_CAPTURE_REQUIRED");
  return { status: "ACTION_RESPONSE_CAPTURED", kind, payoutId: result.outcome.payoutId ?? null };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SELF).toLowerCase()) {
  const [operation, directory, kind, ...extra] = process.argv.slice(2);
  void (async () => { check(directory && !extra.length, "CASH_STAGE_BROWSER_USAGE_INVALID");
    if (operation === "form") { check(kind === undefined, "CASH_STAGE_BROWSER_USAGE_INVALID");
      return runCashStageForm(directory); }
    if (operation === "usd-preview") { check(kind === undefined, "CASH_STAGE_BROWSER_USAGE_INVALID");
      return runCashStageUsdPreview(directory); }
    check(operation === "action" && kind, "CASH_STAGE_BROWSER_USAGE_INVALID");
    return runCashStageRemainingAction(directory, kind);
  })().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { const code = error instanceof Error ? error.message : "";
      process.stderr.write(`${JSON.stringify({ status: "STOP", code: /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code :
        "CASH_STAGE_BROWSER_FAILED_INSPECT" })}\n`);
      process.exitCode = 1;
    });
}
