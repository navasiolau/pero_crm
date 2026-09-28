/** Reviewed staging transport only. Import is inert; no deploy, migration or service control. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineeringPlanSha256, validateEngineeringPlan } from "./engineering-owned-fixtures.mjs";

const SELF = fileURLToPath(import.meta.url);
const WEB = resolve(dirname(SELF), "..");
const ROOT = resolve(WEB, "../..");
const REVIEWED_ROOT = "D:\\Projects\\pero_crm_worktrees\\product-engineering-pay";
const WRAPPER = join(ROOT, "deploy", "acceptance", "engineering-staging-qa.py");
const ENTRY = join(WEB, "tests", "engineering-stage-entry.mjs");
const HELPER = join(WEB, "tests", "engineering-owned-fixtures.mjs");
const PREFIX = "pero-engineering-qa-staging-";
const SUPPORT_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790";
const REVISION = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const require = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
function stop(ok, code) { if (!ok) throw new Error(code); }
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
function fileHash(path) { return sha(readFileSync(path)); }
function sourceGuard() {
  stop(process.platform === "win32" && realpathSync(ROOT).toLowerCase() === REVIEWED_ROOT.toLowerCase() &&
    realpathSync(process.cwd()).toLowerCase() === realpathSync(WEB).toLowerCase(), "REVIEWED_WORKTREE_REQUIRED");
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "DIRECT_URL", "DOCKER_HOST", "DOCKER_CONFIG", "PYTHONPATH"])
    stop(!process.env[name], "AMBIENT_OVERRIDE_FORBIDDEN");
}
function safeEnv() {
  const keys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "ssh_auth_sock", "username", "userdomain", "programdata", "allusersprofile"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.has(key.toLowerCase())));
}
function privateDir() {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, env: safeEnv() }).match(/S-1-\d+(?:-\d+)+/g);
  stop(sid?.length === 1, "PRIVATE_OWNER_REQUIRED");
  execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
    { windowsHide: true, env: safeEnv(), stdio: "pipe" });
  return directory;
}
function stateDir(input) {
  stop(typeof input === "string" && isAbsolute(input), "STATE_PATH_REQUIRED");
  const dir = realpathSync(input);
  stop(dirname(dir).toLowerCase() === realpathSync(tmpdir()).toLowerCase() && dir.split(/[\\/]/).at(-1).startsWith(PREFIX),
    "STATE_PATH_FORBIDDEN");
  return dir;
}
function save(dir, name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + "\n", "utf8");
  const file = join(dir, name);
  const handle = openSync(file, "wx", 0o600);
  try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
  stop(fileHash(file) === sha(bytes), "DURABLE_READBACK_FAILED");
  return file;
}
function load(dir, name) {
  const file = join(dir, name);
  stop(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "STATE_FILE_MISSING_OR_LINK");
  return read(file);
}
export function validateEngineeringStageSeal(seal) {
  stop(seal?.format === "pero-engineering-stage-seal/v1" && seal.sealedBy === "root" && REVISION.test(seal.expectedRevision ?? ""),
    "ROOT_STAGE_SEAL_INVALID");
  const fields = ["wrapperSha256", "bundleSha256", "runnerSha256", "entrySha256", "helperSha256", "supportSha256", "backupReceiptSha256"];
  stop(Object.keys(seal).length === fields.length + 4 && fields.every((key) => HASH.test(seal[key] ?? "")) &&
    seal.supportSha256 === SUPPORT_SHA && UUID.test(seal.backupRunId ?? ""), "ROOT_STAGE_SEAL_INVALID");
  return seal;
}
export async function buildEngineeringStageBundle() {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({ entryPoints: [ENTRY], bundle: true, write: false, platform: "node", format: "esm", target: "node22",
    external: ["@prisma/client", "@node-rs/argon2", "@auth/core/jwt"], logLevel: "silent" });
  stop(built.outputFiles.length === 1 && built.outputFiles[0].contents.length <= 768 * 1024, "BUNDLE_SIZE_INVALID");
  return Buffer.from(built.outputFiles[0].contents);
}
async function reviewed(seal) {
  sourceGuard(); validateEngineeringStageSeal(seal);
  const bundle = await buildEngineeringStageBundle();
  stop(fileHash(WRAPPER) === seal.wrapperSha256 && fileHash(SELF) === seal.runnerSha256 &&
    fileHash(ENTRY) === seal.entrySha256 && fileHash(HELPER) === seal.helperSha256 && sha(bundle) === seal.bundleSha256,
  "REVIEWED_SOURCE_CHANGED");
  return bundle;
}
function sealFile(path) {
  stop(typeof path === "string" && isAbsolute(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
    "ROOT_SEAL_FILE_REQUIRED");
  return validateEngineeringStageSeal(read(path));
}
function control(dir) {
  const value = load(dir, "control.json");
  stop(value.format === "pero-engineering-stage-control/v1" && value.target === "staging", "CONTROL_INVALID");
  return value;
}
function sshBinary() {
  const file = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
  stop(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink() && realpathSync(file).toLowerCase() === file.toLowerCase(),
    "WINDOWS_SSH_IDENTITY_REQUIRED");
  return file;
}
async function transport(dir, packet) {
  const wire = Buffer.from(JSON.stringify(packet), "utf8");
  stop(wire.length <= 2 * 1024 * 1024, "PACKET_TOO_LARGE");
  const remote = `/root/pero-engineering-qa-${packet.seal.wrapperSha256}.py`;
  const bounded = (limit) => {
    const chunks = []; let total = 0; let kept = 0;
    return { push(chunk) { total += chunk.length; const size = Math.min(limit - kept, chunk.length);
      if (size > 0) { chunks.push(Buffer.from(chunk.subarray(0, size))); kept += size; } },
    result() { return { bytes: Buffer.concat(chunks), total }; } };
  };
  const stdout = bounded(2 * 1024 * 1024), stderr = bounded(128 * 1024);
  const result = await new Promise((done) => {
    const child = spawn(sshBinary(), ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "crm-staging", "python3", remote],
      { windowsHide: true, env: safeEnv(), stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.stdin.on("error", () => { /* child close decides uncertain outcome */ });
    child.once("error", () => done({ code: null, error: true }));
    child.once("close", (code) => done({ code, error: false }));
    child.stdin.end(wire);
  });
  const out = stdout.result(), err = stderr.result();
  const output = out.bytes, errors = err.bytes;
  // Sessions contain live cookies: never persist their raw transport.
  if (packet.operation !== "sessions") {
    save(dir, `${packet.operation}-${packet.attemptId}-stdout.bin`, output.subarray(0, 2 * 1024 * 1024));
    save(dir, `${packet.operation}-${packet.attemptId}-stderr.bin`, errors.subarray(0, 128 * 1024));
  }
  stop(!result.error && result.code === 0 && out.total <= 2 * 1024 * 1024 && err.total <= 128 * 1024,
    "SSH_OUTCOME_UNKNOWN_INSPECT");
  let body;
  try { body = JSON.parse(output.toString("utf8")); } catch { throw new Error("SSH_JSON_UNKNOWN_INSPECT"); }
  if (body?.publicSummary?.status === "STOP") throw new Error(/^[A-Z][A-Z0-9_]{2,100}$/.test(body.publicSummary.code) ? body.publicSummary.code : "STAGE_STOP_INSPECT");
  stop(body?.attemptId === packet.attemptId && body.operation === packet.operation && body.identity?.hostname === "crm-staging" &&
    body.identity?.revision === packet.seal.expectedRevision && body.result?.publicSummary?.status === "PASS", "STAGE_RESPONSE_INVALID_INSPECT");
  return body.result;
}
async function send(dir, operation, input, runId = null) {
  stop(runId === null || UUID.test(runId), "RUN_ID_INVALID");
  const data = control(dir);
  const bundle = await reviewed(data.seal);
  const packet = { seal: data.seal, operation, attemptId: randomUUID(), runId,
    input: { operation, target: "staging", ...input }, bundle: bundle.toString("base64") };
  return transport(dir, packet);
}
export async function initEngineeringStage(sealPath) {
  const seal = sealFile(sealPath);
  await reviewed(seal);
  const dir = privateDir();
  save(dir, "control.json", { format: "pero-engineering-stage-control/v1", target: "staging", seal });
  const result = await send(dir, "refs", {});
  save(dir, "refs.json", result.privatePayload);
  return { status: "PASS", operation: "init", directory: dir, refs: result.privatePayload };
}
export async function engineeringStageOperation({ operation, directory, managerId, clientId, partial = false }) {
  sourceGuard();
  const dir = stateDir(directory);
  stop(["plan", "prepare", "capture", "cleanup"].includes(operation), "OPERATION_FORBIDDEN");
  const hasPlan = existsSync(join(dir, "plan.json"));
  if (operation === "plan") {
    stop(!hasPlan && typeof managerId === "string" && typeof clientId === "string", "PLAN_ALREADY_EXISTS_OR_IDS_MISSING");
    const result = await send(dir, "plan", { managerId, clientId });
    const plan = result.privatePayload;
    validateEngineeringPlan(plan);
    save(dir, "plan.json", plan);
    save(dir, "plan-sha256.json", { sha256: engineeringPlanSha256(plan) });
    stop(engineeringPlanSha256(load(dir, "plan.json")) === load(dir, "plan-sha256.json").sha256, "PLAN_READBACK_FAILED");
    return { status: "PASS", operation, directory: dir, runId: plan.runId };
  }
  const plan = load(dir, "plan.json");
  validateEngineeringPlan(plan);
  stop(load(dir, "plan-sha256.json").sha256 === engineeringPlanSha256(plan), "PLAN_SHA_MISMATCH");
  if (operation === "prepare") {
    stop(!existsSync(join(dir, "prepare-intent.json")) && !existsSync(join(dir, "manifest.json")), "PREPARE_ALREADY_ATTEMPTED");
    save(dir, "prepare-intent.json", { runId: plan.runId, planSha256: engineeringPlanSha256(plan), at: new Date().toISOString() });
    const result = await send(dir, operation, { plan, durablePlanSha256: engineeringPlanSha256(plan) }, plan.runId);
    save(dir, "manifest.json", result.privatePayload);
    stop(load(dir, "manifest.json").runId === plan.runId, "MANIFEST_READBACK_FAILED");
    return { status: "PASS", operation, runId: plan.runId };
  }
  const manifest = load(dir, "manifest.json");
  stop(manifest.runId === plan.runId && manifest.manifestHash, "MANIFEST_MISMATCH");
  if (operation === "capture") {
    stop(!existsSync(join(dir, "captured.json")), "CAPTURE_ALREADY_EXISTS");
    const result = await send(dir, operation, { manifest, expectFinal: !partial }, plan.runId);
    save(dir, "captured.json", result.privatePayload);
    return { status: "PASS", operation, runId: plan.runId, phase: result.privatePayload.phase };
  }
  stop(!existsSync(join(dir, "cleanup-intent.json")) && !existsSync(join(dir, "cleaned.json")), "CLEANUP_ALREADY_ATTEMPTED");
  const captured = load(dir, "captured.json"), proof = load(dir, "engineering-browser-drained.json");
  stop(proof.runId === plan.runId && proof.actionsDrained === true && proof.contextsClosed === true, "BROWSER_NOT_DRAINED");
  save(dir, "cleanup-intent.json", { runId: plan.runId, graphHash: captured.graphHash, at: new Date().toISOString() });
  const result = await send(dir, operation, { manifest, captured, actionsDrained: true }, plan.runId);
  save(dir, "cleaned.json", result.privatePayload);
  return { status: "PASS", operation, runId: plan.runId, deleted: result.privatePayload.deleted };
}
export async function engineeringStageSessions(directory) {
  sourceGuard();
  const dir = stateDir(directory), plan = load(dir, "plan.json");
  validateEngineeringPlan(plan);
  stop(existsSync(join(dir, "manifest.json")), "PREPARED_MANIFEST_REQUIRED");
  const result = await send(dir, "sessions", { plan }, plan.runId);
  return result.privatePayload; // live cookies + deployed server-reference manifest, memory only
}

async function main() {
  const [operation, first, second, third, ...extra] = process.argv.slice(2);
  stop(extra.length === 0, "USAGE_INVALID");
  if (operation === "init") { stop(isAbsolute(first) && second === undefined, "USAGE_INVALID"); return initEngineeringStage(first); }
  if (operation === "plan") { stop(first && second && third, "USAGE_INVALID"); return engineeringStageOperation({ operation, directory: first, managerId: second, clientId: third }); }
  if (operation === "capture") { stop(first && (second === undefined || second === "--partial") && third === undefined, "USAGE_INVALID");
    return engineeringStageOperation({ operation, directory: first, partial: second === "--partial" }); }
  stop(["prepare", "cleanup"].includes(operation) && first && second === undefined, "USAGE_INVALID");
  return engineeringStageOperation({ operation, directory: first });
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SELF).toLowerCase()) {
  void main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    const message = error instanceof Error ? error.message : "";
    console.error(JSON.stringify({ status: "STOP", code: /^[A-Z][A-Z0-9_]{2,100}$/.test(message) ? message : "STAGE_FAILED_INSPECT" }));
    process.exitCode = 1;
  });
}
