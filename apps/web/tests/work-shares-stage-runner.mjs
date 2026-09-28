/**
 * Root-owned staging transport, opt-in only; no side effects on import.
 * SAFETY: D:\Projects\pero_infra\infra-recovery\SAFETY-RULES.md. STOP on drift.
 *
 * CLI (from apps/web; no command below is automatic):
 *   node tests/work-shares-stage-runner.mjs seal <FULL_40_HEX_REVISION> <ABS_SEAL_FILE>
 *   node tests/work-shares-stage-runner.mjs init <ABS_SEAL_FILE>
 *   node tests/work-shares-stage-runner.mjs <operation> <PRIVATE_CONTROL_DIR> <ABS_SEAL_FILE>
 * Operations: backup-preflight, backup-check, migration-check, plan, prepare,
 * inspect, capture, cleanup. Copy reviewed Python manually to its SHA-named
 * /root/pero-work-shares-<wrapperSha256>.py on crm-staging before any operation.
 *
 * The old live SHA is sealed for backup-preflight / backup-check. Immediately
 * before the root's feature push, backup-check must still match. After the root's
 * CI/deploy, a NEW explicit seal pins the feature SHA; migration-check proves the
 * additive migration preserved the old rows. Both seals must pin identical code
 * and source hashes. This runner never pushes, deploys, migrates or restores.
 * ApiToken.lastUsedAt is volatile usage metadata: wrapper receipts retain the
 * full hash/dates and report actual changes; protected fingerprints omit ONLY
 * that field. Old full-hash QA envelopes/backups are not rewritten or upgraded.
 * After this policy/helper revision, root explicitly creates a new seal/backup.
 *
 * Browser contract (import, never print returned private payload):
 *   const prepared = await stageOperation({operation:'prepare',directory,sealFile});
 *   const sessions = await stageOperation({operation:'sessions',directory,sealFile});
 *   // sessions.privatePayload.sessions live only in this browser process.
 *   // Use prepared.privatePayload.envelope.body.plan for EXACT owned targets.
 *   // After every owned browser context is closed and actions are drained:
 *   recordActionsDrained({directory,browserProofFile:
 *       '<browser outputDir>/browser-drained.json'});
 *   await stageOperation({operation:'capture',directory,sealFile});
 *   await stageOperation({operation:'cleanup',directory,sealFile});
 * Cleanup is never an automatic finally action. A failed/lost prepare or cleanup
 * writes an outcome-unknown receipt: use inspect, never repeat a write blindly.
 * A subsequent intentional recovery needs separate root review; there is no
 * force/retry/reset switch. inspect persists diagnostics without authorizing it.
 *
 * Local receipt examples (all private, exclusive create+fsync+readback):
 * backup.json = {runId,receiptSha256,receipt}; plan.json = signed QA envelope;
 * prepare-intent.json = {operation,attemptId,envelopeSha256,revision,startedAt};
 * prepare-outcome.json = {outcome:'PASS'|'STOP_OR_UNKNOWN',publicSummary,...}.
 * Each completed SSH attempt also writes an exclusive transport receipt plus
 * bounded raw stdout (2 MiB) and stderr (128 KiB) in this PRIVATE directory.
 * Raw files may contain sensitive data: never print, attach or commit them.
 * Session-operation raw streams remain in memory only. Public diagnostics contain
 * exit/signal/error codes and byte counts, never raw output or input/environment.
 * A runner update invalidates previous seals. Explicitly create a new seal and
 * control after root has inspected the old ambiguous run; never edit its intent,
 * outcome or control to make it retryable.
 * pg_restore --list is archive integrity only, never claimed as a restore test.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalEnvelope, envelopeSha256 } from "./work-shares-owned-fixtures.mjs";

const SELF = fileURLToPath(import.meta.url);
const WEB = resolve(dirname(SELF), "..");
const ROOT = resolve(WEB, "../..");
const APPROVED_ROOT = "D:\\Projects\\pero_crm_worktrees\\universal-work-shares";
const WRAPPER = join(ROOT, "deploy", "acceptance", "staging-work-shares.py");
const HELPER = join(WEB, "tests", "work-shares-owned-fixtures.mjs");
const MIGRATIONS = join(WEB, "prisma", "migrations");
const MIGRATION = "20260928140000_universal_work_shares";
const SQL_SHA = "65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6";
const HELPER_SHA = "53a66a649d8ef2611c7b027175b0c078825fa7bb34f4a9849d309065849564f0";
const PREFIX = "pero-work-shares-stage-";
const FORMAT = "pero-work-shares-staging-seal/v1";
const BASE_URL = "https://staging-crm.peromebel.by";
const QA_OPS = new Set(["plan", "prepare", "capture", "inspect", "cleanup", "sessions"]);
const BACKUP_OPS = new Set(["backup-preflight", "backup-check", "migration-check"]);
const MUTATIONS = new Set(["prepare", "cleanup"]);
const HASH = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const require = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => canonicalEnvelope(a) === canonicalEnvelope(b);

export class StageStop extends Error {
  constructor(code, transportSummary) {
    super(code); this.name = "StageStop"; this.code = code;
    if (transportSummary) this.transport = transportSummary;
  }
}
function guard(value, code) { if (!value) throw new StageStop(code); }
function safeCode(error) { return error instanceof StageStop ? error.code : "LOCAL_RUNNER_FAILED_INSPECT_OUTCOME"; }
function plainFile(path) {
  const info = lstatSync(path);
  guard(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, "PLAIN_SINGLE_LINK_FILE_REQUIRED");
  return info;
}
function fileHash(path) { plainFile(path); return sha(readFileSync(path)); }
function readJson(path) {
  guard(plainFile(path).size <= 2 * 1024 * 1024, "PRIVATE_FILE_TOO_LARGE");
  return JSON.parse(readFileSync(path, "utf8"));
}
function durable(path, value) {
  guard(isAbsolute(path), "ABSOLUTE_ARTIFACT_REQUIRED");
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : canonicalEnvelope(value), "utf8");
  const descriptor = openSync(path, "wx", 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  if (process.platform !== "win32") {
    const parent = openSync(dirname(path), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  guard(fileHash(path) === sha(bytes), "DURABLE_FILE_READBACK_FAILED");
  return sha(bytes);
}
function safeChildEnv(extra = {}) {
  const keys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "ssh_auth_sock", "username", "userdomain", "programdata", "allusersprofile"]);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.has(key.toLowerCase()))), ...extra };
}
function sshExecutable() {
  // Match the verified working Windows PowerShell command, without PATH lookup.
  const file = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
  const info = lstatSync(file);
  guard(info.isFile() && !info.isSymbolicLink() && realpathSync(file).toLowerCase() === file.toLowerCase(), "WINDOWS_OPENSSH_IDENTITY_REQUIRED");
  return file;
}

/** Pure bounded collector; never kills a remote process when a limit is reached. */
export function createBoundedCapture(limit) {
  guard(Number.isSafeInteger(limit) && limit > 0, "CAPTURE_LIMIT_INVALID");
  const chunks = [];
  let totalBytes = 0; let capturedBytes = 0;
  return {
    push(chunk) {
      guard(Buffer.isBuffer(chunk), "CAPTURE_BUFFER_REQUIRED");
      totalBytes += chunk.length;
      const remaining = limit - capturedBytes;
      if (remaining > 0) {
        const keep = Buffer.from(chunk.subarray(0, remaining));
        chunks.push(keep); capturedBytes += keep.length;
      }
    },
    snapshot() { return { bytes: Buffer.concat(chunks), totalBytes, capturedBytes, truncated: totalBytes > capturedBytes }; },
  };
}

function safeIoCode(error) {
  return new Set(["ENOENT", "EACCES", "EPERM", "EPIPE", "ECONNRESET", "EINVAL", "UNKNOWN"]).has(error?.code) ? error.code : "IO_ERROR";
}
function sourceGuard() {
  guard(process.platform === "win32" && realpathSync(ROOT).toLowerCase() === APPROVED_ROOT.toLowerCase() &&
    realpathSync(process.cwd()).toLowerCase() === realpathSync(WEB).toLowerCase(), "REVIEWED_WORKTREE_AND_CWD_REQUIRED");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "DIRECT_URL", "DOCKER_HOST", "DOCKER_CONFIG", "PYTHONPATH"])
    guard(!process.env[key], "AMBIENT_OVERRIDE_FORBIDDEN");
}
function source() {
  sourceGuard();
  const migrations = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => {
    guard(!entry.isSymbolicLink() && /^[0-9]{14}_[a-z0-9_]+$/.test(entry.name), "MIGRATION_DIRECTORY_INVALID");
    const file = join(MIGRATIONS, entry.name, "migration.sql");
    const bytes = readFileSync(file);
    // Git/Linux SQL is LF. Preserve the actual checkout digest too so a mixed
    // historical ledger is not confused with content drift. New SQL is fixed LF.
    return { name: entry.name, sha256: sha(bytes.toString("utf8").replaceAll("\r\n", "\n")), checkoutSha256: fileHash(file) };
  }).sort((a, b) => a.name.localeCompare(b.name, "en"));
  guard(fileHash(join(MIGRATIONS, MIGRATION, "migration.sql")) === SQL_SHA, "REVIEWED_SQL_CHANGED");
  guard(fileHash(HELPER) === HELPER_SHA, "REVIEWED_OWNED_HELPER_CHANGED");
  return { migration: MIGRATION, sqlSha256: SQL_SHA, schemaSha256: fileHash(join(WEB, "prisma", "schema.prisma")),
    migrationLockSha256: fileHash(join(MIGRATIONS, "migration_lock.toml")), ownedHelperSha256: HELPER_SHA, migrations };
}

export function validateSeal(seal) {
  guard(seal && typeof seal === "object" && same(Object.keys(seal).sort(), ["bundleSha256", "expectedRevision", "format", "runnerSha256", "sealedBy", "source", "wrapperSha256"]), "SEAL_FIELDS_INVALID");
  guard(seal.format === FORMAT && seal.sealedBy === "root" && REVISION.test(seal.expectedRevision), "FULL_ROOT_SEALED_REVISION_REQUIRED");
  for (const key of ["wrapperSha256", "runnerSha256", "bundleSha256"]) guard(HASH.test(seal[key]), "SEAL_HASH_INVALID");
  guard(seal.source?.migration === MIGRATION && seal.source?.sqlSha256 === SQL_SHA && seal.source?.ownedHelperSha256 === HELPER_SHA, "SEAL_SOURCE_INVALID");
  return seal;
}

export async function buildStageBundle() {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  // external argon2 is native and already belongs to the app runtime. No install.
  const built = await build({ stdin: { contents: `
import { executeOwnedQa } from './work-shares-owned-fixtures.mjs';
const stop = (code) => ({publicSummary:{status:'STOP',code},privatePayload:null});
let result;
try {
  const raw=process.env.CRM_WORK_SHARES_QA_INPUT;
  if(!raw || raw.length>98304 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error();
  const request=JSON.parse(Buffer.from(raw,'base64').toString('utf8'));
  delete process.env.CRM_WORK_SHARES_QA_INPUT;
  if(request.target!=='staging' || !['plan','prepare','capture','inspect','cleanup','sessions'].includes(request.operation) ||
    Object.keys(request).some(k=>!['operation','target','envelope','durablePlanSha256','durableCheckpointSha256','actionsDrained','baseUrl'].includes(k))) throw new Error();
  result=await executeOwnedQa(request);
} catch(error) {
  result=stop(error?.code==='DISCONNECT_FAILED_INSPECT_OUTCOME' ? error.code : 'QA_ENTRY_FAILED_INSPECT_OUTCOME');
}
process.stdout.write(JSON.stringify(result));
process.exitCode=result.publicSummary?.status==='PASS'?0:1;
`, resolveDir: dirname(HELPER), sourcefile: "work-shares-stage-entry.mjs", loader: "js" },
    bundle: true, write: false, platform: "node", format: "esm", target: "node22",
    external: ["@prisma/client", "@node-rs/argon2"], logLevel: "silent" });
  guard(built.outputFiles.length === 1 && built.outputFiles[0].contents.length <= 768 * 1024, "BUNDLE_SIZE_INVALID");
  return Buffer.from(built.outputFiles[0].contents);
}

export async function createSeal({ expectedRevision, outputFile }) {
  guard(typeof expectedRevision === "string" && REVISION.test(expectedRevision), "FULL_ROOT_SEALED_REVISION_REQUIRED");
  const current = source();
  const bytes = await buildStageBundle();
  const seal = { format: FORMAT, sealedBy: "root", expectedRevision, wrapperSha256: fileHash(WRAPPER),
    runnerSha256: fileHash(SELF), bundleSha256: sha(bytes), source: current };
  durable(outputFile, seal);
  return { status: "PASS", operation: "seal", expectedRevision, sealSha256: fileHash(outputFile), wrapperSha256: seal.wrapperSha256,
    remoteWrapper: `/root/pero-work-shares-${seal.wrapperSha256}.py`, execution: "NOT_RUN" };
}

function ownerSid() {
  const text = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, env: safeChildEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const matches = text.match(/S-1-\d+(?:-\d+)+/g);
  guard(matches?.length === 1, "LOCAL_OWNER_SID_REQUIRED");
  return matches[0];
}
function checkPrivateDirectory(directory) {
  guard(isAbsolute(directory), "ABSOLUTE_CONTROL_DIRECTORY_REQUIRED");
  const real = realpathSync(directory);
  const info = lstatSync(directory);
  guard(info.isDirectory() && !info.isSymbolicLink() && dirname(real).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    basename(real).startsWith(PREFIX), "PRIVATE_CONTROL_DIRECTORY_REQUIRED");
  if (process.platform === "win32") {
    // Fixed script; the path is an env value, never executable interpolation.
    const script = "$a=Get-Acl -LiteralPath $env:CRM_QA_ACL_DIR; [pscustomobject]@{protected=$a.AreAccessRulesProtected;rules=@($a.Access | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();inherited=$_.IsInherited} })} | ConvertTo-Json -Compress -Depth 4";
    const acl = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", windowsHide: true, env: safeChildEnv({ CRM_QA_ACL_DIR: real }), stdio: ["ignore", "pipe", "pipe"] }));
    const allowed = new Set([ownerSid(), "S-1-5-18", "S-1-5-32-544"]);
    guard(acl.protected === true && Array.isArray(acl.rules) && acl.rules.length > 0 &&
      acl.rules.every((rule) => allowed.has(rule.sid) && rule.type === "Allow" && !rule.inherited), "PRIVATE_CONTROL_ACL_CHANGED");
  } else guard((info.mode & 0o777) === 0o700 && info.uid === process.getuid(), "PRIVATE_CONTROL_MODE_CHANGED");
  return real;
}

async function sealedCode(sealFile) {
  const seal = validateSeal(readJson(sealFile));
  const current = source();
  guard(same(seal.source, current) && seal.wrapperSha256 === fileHash(WRAPPER) && seal.runnerSha256 === fileHash(SELF), "SEALED_SOURCE_CHANGED");
  const bytes = await buildStageBundle();
  guard(sha(bytes) === seal.bundleSha256, "SEALED_BUNDLE_CHANGED");
  return { seal, bytes };
}

export async function createControl({ sealFile }) {
  const { seal } = await sealedCode(sealFile);
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  if (process.platform === "win32") execFileSync("icacls", [directory, "/inheritance:r", "/grant:r",
    `*${ownerSid()}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], { windowsHide: true, env: safeChildEnv(), stdio: "pipe" });
  checkPrivateDirectory(directory);
  durable(join(directory, "control.json"), { format: "pero-work-shares-stage-control/v1", backupRunId: randomUUID(),
    initialSeal: seal, baseUrl: BASE_URL, createdAt: new Date().toISOString() });
  return { status: "PASS", operation: "init", directory, execution: "NOT_RUN" };
}

async function transport(packet, directory) {
  const remote = `/root/pero-work-shares-${packet.seal.wrapperSha256}.py`;
  const wire = JSON.stringify(packet);
  guard(Buffer.byteLength(wire) <= 2 * 1024 * 1024, "PACKET_TOO_LARGE");
  const executable = sshExecutable();
  const output = createBoundedCapture(2 * 1024 * 1024);
  const errors = createBoundedCapture(128 * 1024);
  const result = await new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(executable, ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "crm-staging", "python3", remote],
        { windowsHide: true, env: safeChildEnv(), stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) { resolveResult({ code: null, signal: null, spawnErrorCode: safeIoCode(error), stdinErrorCode: null }); return; }
    let spawnErrorCode = null; let stdinErrorCode = null;
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk)); // Private bounded capture only.
    child.once("error", (error) => { spawnErrorCode = safeIoCode(error); });
    child.stdin.on("error", (error) => { stdinErrorCode = safeIoCode(error); });
    child.once("close", (code, signal) => resolveResult({ code, signal, spawnErrorCode, stdinErrorCode }));
    // No outer timeout, abort signal or kill-on-size: wait for container-local
    // supervision AND remote lock release. An operator disconnect is UNKNOWN.
    child.stdin.end(wire);
  });
  const stdout = output.snapshot(), stderr = errors.snapshot();
  const diagnostics = {
    exitCode: Number.isInteger(result.code) ? result.code : null,
    signal: typeof result.signal === "string" && /^SIG[A-Z0-9]{1,16}$/.test(result.signal) ? result.signal : null,
    spawnErrorCode: result.spawnErrorCode, stdinErrorCode: result.stdinErrorCode,
    stdoutBytes: stdout.totalBytes, stderrBytes: stderr.totalBytes,
    stdoutCapturedBytes: stdout.capturedBytes, stderrCapturedBytes: stderr.capturedBytes,
    stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated,
    rawCapture: packet.operation === "sessions" ? "SESSION_MEMORY_ONLY" : "PRIVATE_FILES",
  };
  const prefix = `${packet.operation}-${packet.attemptId}-ssh`;
  try {
    if (packet.operation !== "sessions") {
      durable(join(directory, `${prefix}-stdout.bin`), stdout.bytes);
      durable(join(directory, `${prefix}-stderr.bin`), stderr.bytes);
    }
    durable(join(directory, `${prefix}-transport.json`), diagnostics);
  } catch { throw new StageStop("SSH_DIAGNOSTIC_PERSIST_FAILED_INSPECT_OUTCOME", diagnostics); }
  try {
    guard(!result.spawnErrorCode && !result.stdinErrorCode && !stdout.truncated, "SSH_TRANSPORT_UNKNOWN_USE_INSPECT");
    let body;
    try { body = JSON.parse(stdout.bytes.toString("utf8")); } catch { throw new StageStop("SSH_JSON_UNKNOWN_USE_INSPECT"); }
    if (body.publicSummary?.status === "STOP") {
      guard(/^[A-Z][A-Z0-9_]{2,100}$/.test(body.publicSummary.code ?? ""), "WRAPPER_UNSAFE_FAILURE");
      throw new StageStop(body.publicSummary.code);
    }
    guard(body.attemptId === packet.attemptId && body.operation === packet.operation &&
      body.identity?.hostname === "crm-staging" && body.identity?.revision === packet.seal.expectedRevision,
    "STAGE_RESPONSE_IDENTITY_MISMATCH");
    const summary = body.result?.publicSummary;
    guard(summary && ["PASS", "STOP"].includes(summary.status), "STAGE_RESULT_INVALID");
    if (summary.status === "STOP") {
      guard(/^[A-Z][A-Z0-9_]{2,100}$/.test(summary.code ?? ""), "STAGE_UNSAFE_FAILURE");
      throw new StageStop(summary.code);
    }
    guard(result.code === 0 && summary.operation === packet.operation, "STAGE_EXIT_UNKNOWN_USE_INSPECT");
    durable(join(directory, `${packet.operation}-${packet.attemptId}-public.json`), { identity: body.identity, publicSummary: summary, transport: diagnostics });
    return { ...body.result, identity: body.identity, transport: diagnostics };
  } catch (error) {
    throw new StageStop(safeCode(error), diagnostics);
  }
}

function readEnvelope(directory, name) {
  const file = join(directory, name);
  const envelope = readJson(file);
  guard(fileHash(file) === envelopeSha256(envelope), "ENVELOPE_CANONICAL_READBACK_REQUIRED");
  return envelope;
}

export function recordActionsDrained({ directory, browserProofFile }) {
  sourceGuard();
  directory = checkPrivateDirectory(directory);
  guard(isAbsolute(browserProofFile), "ABSOLUTE_BROWSER_PROOF_REQUIRED");
  const evidence = readJson(browserProofFile);
  const plan = readEnvelope(directory, "plan.json");
  guard(evidence && evidence.version === 1 && evidence.runId === plan.body.plan.runId && evidence.actionsDrained === true &&
    evidence.contextsClosed === true && evidence.browserClosed === true && evidence.interceptsPending === 0 && evidence.uncertainMutation === false,
    "BROWSER_DRAIN_PROOF_REQUIRED");
  guard(existsSync(join(directory, "prepared.json")) && !existsSync(join(directory, "cleanup-intent.json")), "BROWSER_DRAIN_PHASE_INVALID");
  return durable(join(directory, "browser-drained.json"), { actionsDrained: true, contextsClosed: true, inflightActions: 0,
    at: new Date().toISOString(), runId: plan.body.plan.runId, browserProofSha256: fileHash(browserProofFile),
    planSha256: envelopeSha256(plan),
    preparedSha256: envelopeSha256(readEnvelope(directory, "prepared.json")) });
}

export async function stageOperation({ operation, directory, sealFile }) {
  guard(QA_OPS.has(operation) || BACKUP_OPS.has(operation), "OPERATION_FORBIDDEN");
  const { seal, bytes } = await sealedCode(sealFile);
  directory = checkPrivateDirectory(directory);
  const control = readJson(join(directory, "control.json"));
  guard(control.format === "pero-work-shares-stage-control/v1" && control.baseUrl === BASE_URL, "CONTROL_FORMAT_INVALID");
  const original = validateSeal(control.initialSeal);
  guard(same({ ...seal, expectedRevision: original.expectedRevision }, original), "CONTROL_SOURCE_CHANGED");
  const attemptId = randomUUID();
  const packet = { seal, operation, attemptId };
  let request;
  if (BACKUP_OPS.has(operation)) {
    packet.runId = control.backupRunId;
    if (operation !== "backup-preflight") {
      const saved = readJson(join(directory, "backup.json"));
      guard(saved.runId === packet.runId && HASH.test(saved.receiptSha256), "BACKUP_RECEIPT_REQUIRED");
      packet.receiptSha256 = saved.receiptSha256;
    } else guard(!existsSync(join(directory, "backup-preflight-intent.json")), "BACKUP_ALREADY_ATTEMPTED_INSPECT_ARTIFACTS");
  } else {
    const checked = readJson(join(directory, "migration-checked.json"));
    guard(checked.identity.revision === seal.expectedRevision && checked.publicSummary.status === "PASS", "MIGRATION_ACCEPTANCE_REQUIRED");
    request = { operation, target: "staging" };
    if (operation === "plan") guard(!existsSync(join(directory, "plan.json")) && !existsSync(join(directory, "plan-intent.json")), "QA_PLAN_ALREADY_ATTEMPTED");
    else {
      const file = operation === "prepare" ? "plan.json" :
        existsSync(join(directory, "captured.json")) ? "captured.json" :
        existsSync(join(directory, "prepared.json")) ? "prepared.json" : "plan.json";
      request.envelope = readEnvelope(directory, file);
      if (operation === "prepare") request.durablePlanSha256 = envelopeSha256(request.envelope);
    }
    if (MUTATIONS.has(operation)) guard(!existsSync(join(directory, `${operation}-intent.json`)), "WRITE_ALREADY_ATTEMPTED_USE_INSPECT");
    if (["sessions", "capture"].includes(operation)) guard(existsSync(join(directory, "prepared.json")), "PREPARED_CHECKPOINT_REQUIRED");
    if (operation === "sessions") {
      guard(!existsSync(join(directory, "browser-drained.json")) && !existsSync(join(directory, "cleanup-intent.json")), "BROWSER_ACTIONS_ALREADY_DRAINED");
      request.baseUrl = BASE_URL;
    }
    if (["capture", "cleanup"].includes(operation)) {
      const drained = readJson(join(directory, "browser-drained.json"));
      guard(drained.actionsDrained === true && drained.contextsClosed === true && drained.inflightActions === 0 &&
        drained.planSha256 === envelopeSha256(readEnvelope(directory, "plan.json")) &&
        drained.preparedSha256 === envelopeSha256(readEnvelope(directory, "prepared.json")), "DURABLE_BROWSER_DRAIN_REQUIRED");
    }
    if (operation === "capture") guard(!existsSync(join(directory, "captured.json")), "CAPTURE_ALREADY_DURABLE");
    if (operation === "cleanup") {
      request.envelope = readEnvelope(directory, "captured.json");
      guard(request.envelope.body.phase === "CAPTURED", "CAPTURED_CHECKPOINT_REQUIRED");
      request.durableCheckpointSha256 = envelopeSha256(request.envelope);
      request.actionsDrained = true;
    }
    packet.input = request;
    packet.bundle = bytes.toString("base64");
  }
  const intent = { operation, attemptId, revision: seal.expectedRevision, startedAt: new Date().toISOString(),
    ...(request?.envelope ? { envelopeSha256: envelopeSha256(request.envelope) } : {}) };
  const single = MUTATIONS.has(operation) || operation === "backup-preflight" || operation === "plan";
  durable(join(directory, `${operation}-${single ? "intent" : `${attemptId}-intent`}.json`), intent);
  try {
    const result = await transport(packet, directory);
    if (operation === "backup-preflight") durable(join(directory, "backup.json"), {
      runId: control.backupRunId, receiptSha256: result.publicSummary.receiptSha256, receipt: result.privatePayload.receipt });
    if (operation === "migration-check") durable(join(directory, "migration-checked.json"), { identity: result.identity, publicSummary: result.publicSummary });
    const envelopeFiles = { plan: "plan.json", prepare: "prepared.json", capture: "captured.json", cleanup: "cleaned.json" };
    if (envelopeFiles[operation]) {
      const envelope = result.privatePayload?.envelope;
      guard(envelope?.body?.plan?.target?.kind === "EXISTING_STAGING", "RECEIVED_ENVELOPE_TARGET_INVALID");
      if (request?.envelope) guard(same(envelope.body.plan, request.envelope.body.plan), "RECEIVED_PLAN_CHANGED");
      const hash = durable(join(directory, envelopeFiles[operation]), canonicalEnvelope(envelope));
      guard(hash === envelopeSha256(envelope), "RECEIVED_ENVELOPE_READBACK_FAILED");
    }
    if (operation === "inspect") durable(join(directory, `inspect-${attemptId}-private.json`), result.privatePayload);
    // Sessions are deliberately excluded from ALL saved payloads and CLI output.
    durable(join(directory, `${operation}-${single ? "outcome" : `${attemptId}-outcome`}.json`), {
      outcome: "PASS", attemptId, publicSummary: result.publicSummary, transport: result.transport, completedAt: new Date().toISOString() });
    return result;
  } catch (error) {
    const code = safeCode(error);
    durable(join(directory, `${operation}-${single ? "outcome" : `${attemptId}-outcome`}.json`), {
      outcome: "STOP_OR_UNKNOWN", attemptId, code, ...(error instanceof StageStop && error.transport ? { transport: error.transport } : {}),
      nextAction: "ROOT_INSPECT_NO_AUTOMATIC_RETRY", at: new Date().toISOString() });
    throw new StageStop(code, error instanceof StageStop ? error.transport : undefined);
  }
}

async function main() {
  const [operation, first, second, ...extra] = process.argv.slice(2);
  guard(extra.length === 0, "CLI_ARGUMENTS_INVALID");
  let summary;
  if (operation === "seal") summary = await createSeal({ expectedRevision: first, outputFile: second });
  else if (operation === "init") { guard(!second, "CLI_ARGUMENTS_INVALID"); summary = await createControl({ sealFile: first }); }
  else {
    guard(operation !== "sessions", "SESSIONS_IMPORT_API_ONLY");
    const result = await stageOperation({ operation, directory: first, sealFile: second });
    summary = { ...result.publicSummary, transport: result.transport };
  }
  process.stdout.write(JSON.stringify(summary) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((error) => {
  process.stdout.write(JSON.stringify({ status: "STOP", code: safeCode(error),
    ...(error instanceof StageStop && error.transport ? { transport: error.transport } : {}) }) + "\n");
  process.exitCode = 1;
});
