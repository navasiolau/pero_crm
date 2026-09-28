/**
 * Opt-in, READ-ONLY staging session bridge. No CLI or work on import.
 * SAFETY: D:\Projects\pero_infra\infra-recovery\SAFETY-RULES.md. STOP on mismatch.
 *
 * Root first calls createStageBrowserSessionSeal({directory, sealFile: original
 * feature seal, outputFile: an unused file IN directory}). The dedicated seal
 * keeps the original source/revision/wrapper and pins this runner + its bundle.
 * Then getStageBrowserSessions({directory, sealFile: dedicated seal}) returns a
 * PRIVATE {publicSummary, privatePayload:{sessions}, identity, transport}.
 * Each session retains cookie and adds companionCookie. Never print the result.
 * AUTH_SECRET and decoded claims remain in the guest; session streams stay only
 * in memory. Only nonsecret source/seal/transport proofs are written locally.
 * This module cannot plan, prepare, capture, clean, migrate or change auth config.
 *
 * Offline verification (no SSH/DB/browser/server):
 * node --input-type=module -e "const m=await import('./tests/work-shares-stage-sessions.mjs'); console.log(await m.selfTestStageSessionBridge())"
 * TDD: original single-cookie result failed the concrete companion-cookie
 * assertion; the paired implementation passes synthetic encode/decode checks.
 * Synthetic tests and bundle syntax are not staging runtime acceptance.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalEnvelope, envelopeSha256 } from "./work-shares-owned-fixtures.mjs";
import { createBoundedCapture, createSeal as createOriginalSeal, StageStop, validateSeal } from "./work-shares-stage-runner.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), ".."), ROOT = resolve(WEB, "../..");
const BASE = "https://staging-crm.peromebel.by";
const HELPER = join(WEB, "tests/work-shares-owned-fixtures.mjs");
const ORIGINAL = join(WEB, "tests/work-shares-stage-runner.mjs");
const WRAPPER = join(ROOT, "deploy/acceptance/staging-work-shares.py");
const HELPER_SHA = "53a66a649d8ef2611c7b027175b0c078825fa7bb34f4a9849d309065849564f0";
const ORIGINAL_SHA = "83ab624100f7f1fd9c3d476750a392f0e79af5c61122634d93b44eb26322709b";
const WRAPPER_SHA = "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790";
const require = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => canonicalEnvelope(a) === canonicalEnvelope(b);

export class StageSessionsStop extends Error {
  constructor(code, transport) { super(code); this.name = "StageSessionsStop"; this.code = code; if (transport) this.transport = transport; }
}
function guard(value, code) { if (!value) throw new StageSessionsStop(code); }
function safeCode(error) {
  return (error instanceof StageSessionsStop || error instanceof StageStop) && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code ?? "")
    ? error.code : "STAGE_SESSION_BRIDGE_FAILED";
}
function read(path) {
  guard(typeof path === "string" && isAbsolute(path), "ABSOLUTE_FILE_REQUIRED");
  const stat = lstatSync(path);
  guard(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2 * 1024 * 1024, "PLAIN_BOUNDED_FILE_REQUIRED");
  return readFileSync(path);
}
const hashFile = (path) => sha(read(path));
const json = (path) => JSON.parse(read(path).toString("utf8"));
function saveProof(path, value) {
  const bytes = Buffer.from(canonicalEnvelope(value));
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  guard(hashFile(path) === sha(bytes), "PROOF_READBACK_FAILED");
}
function childEnv(extra = {}) {
  const keys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "ssh_auth_sock", "username", "userdomain", "programdata", "allusersprofile"]);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.has(key.toLowerCase()))), ...extra };
}
function frozenSources() {
  guard(hashFile(HELPER) === HELPER_SHA && hashFile(ORIGINAL) === ORIGINAL_SHA && hashFile(WRAPPER) === WRAPPER_SHA, "FROZEN_SOURCE_CHANGED");
}
function localGuard() {
  guard(process.platform === "win32" && realpathSync(ROOT).toLowerCase() === "d:\\projects\\pero_crm_worktrees\\universal-work-shares" &&
    realpathSync(process.cwd()).toLowerCase() === realpathSync(WEB).toLowerCase(), "REVIEWED_WORKTREE_AND_CWD_REQUIRED");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "DIRECT_URL", "DOCKER_HOST", "DOCKER_CONFIG", "PYTHONPATH"])
    guard(!process.env[key], "AMBIENT_OVERRIDE_FORBIDDEN");
  frozenSources();
}
function privateDirectory(directory) {
  guard(typeof directory === "string" && isAbsolute(directory), "ABSOLUTE_CONTROL_DIRECTORY_REQUIRED");
  const stat = lstatSync(directory), real = realpathSync(directory);
  guard(stat.isDirectory() && !stat.isSymbolicLink() && dirname(real).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    basename(real).startsWith("pero-work-shares-stage-"), "PRIVATE_CONTROL_DIRECTORY_REQUIRED");
  const output = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const matches = output.match(/S-1-\d+(?:-\d+)+/g);
  guard(matches?.length === 1, "LOCAL_OWNER_SID_REQUIRED");
  const script = "$a=Get-Acl -LiteralPath $env:CRM_QA_ACL_DIR; [pscustomobject]@{protected=$a.AreAccessRulesProtected;rules=@($a.Access | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();inherited=$_.IsInherited} })} | ConvertTo-Json -Compress -Depth 4";
  const acl = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, env: childEnv({ CRM_QA_ACL_DIR: real }), stdio: ["ignore", "pipe", "pipe"] }));
  const allowed = new Set([matches[0], "S-1-5-18", "S-1-5-32-544"]);
  guard(acl.protected === true && Array.isArray(acl.rules) && acl.rules.length > 0 &&
    acl.rules.every((rule) => allowed.has(rule.sid) && rule.type === "Allow" && !rule.inherited), "PRIVATE_CONTROL_ACL_CHANGED");
  return real;
}

/** Closure-free: the reviewed native bundle embeds this same narrow validator. */
export function validateStageSessionRequest(request) {
  const check = (ok, code) => { if (!ok) throw new Error(code); };
  check(request && typeof request === "object" && !Array.isArray(request), "SESSION_REQUEST_INVALID");
  check(Object.keys(request).sort().join(",") === "baseUrl,envelope,operation,target", "SESSION_REQUEST_FIELDS_FORBIDDEN");
  check(request.operation === "sessions" && request.target === "staging" && request.baseUrl === "https://staging-crm.peromebel.by", "SESSION_TARGET_OR_OPERATION_FORBIDDEN");
  check(request.envelope?.body?.phase === "PREPARED" && request.envelope.body.plan?.target?.kind === "EXISTING_STAGING", "PREPARED_STAGING_ENVELOPE_REQUIRED");
  return request;
}

/** Pure crypto boundary. No transport/DB; in the native bundle secret is runtime-only. */
export async function pairStageSessionCookies(result, plan, secret, jwt) {
  const check = (ok, code) => { if (!ok) throw new Error(code); };
  check(typeof secret === "string" && secret.length >= 32, "RUNTIME_SIGNING_SECRET_REQUIRED");
  check(plan?.target?.kind === "EXISTING_STAGING" && Array.isArray(plan.users) && plan.users.length === 2, "STAGING_PLAN_REQUIRED");
  check(result?.publicSummary?.status === "PASS" && result.publicSummary.operation === "sessions" && result.publicSummary.runId === plan.runId &&
    result.publicSummary.count === 3 && result.publicSummary.ttlSeconds === 900, "VERIFIED_SESSION_RESULT_REQUIRED");
  const sessions = result.privatePayload?.sessions, roles = ["manager", "worker", "mounter"], actors = [plan.manager, ...plan.users];
  check(Array.isArray(sessions) && sessions.length === 3 && new Set(sessions.map((item) => item.role)).size === 3 &&
    new Set(actors.map((actor) => actor?.id)).size === 3, "THREE_DISTINCT_ACTORS_REQUIRED");
  const seen = new Set();
  const paired = [];
  for (let index = 0; index < 3; index++) {
    const item = sessions[index], actor = actors[index], cookie = item.cookie;
    check(typeof actor?.id === "string" && actor.id.length > 0 && Array.isArray(actor.roles) && actor.roles.length > 0 &&
      Number.isSafeInteger(actor.sessionVersion) && actor.sessionVersion >= 0, "PLANNED_ACTOR_INVALID");
    check(item.role === roles[index] && item.userId === actor.id, "SESSION_ACTOR_MISMATCH");
    check(cookie?.name === "__Secure-authjs.session-token" && typeof cookie.value === "string" && cookie.value.length > 0 && cookie.value.length < 8192 &&
      cookie.domain === "staging-crm.peromebel.by" && cookie.path === "/" && cookie.httpOnly === true && cookie.secure === true && cookie.sameSite === "Lax", "SESSION_COOKIE_SCOPE_MISMATCH");
    check(!seen.has(cookie.value), "DUPLICATE_SESSION_TOKEN");
    seen.add(cookie.value);
    const claims = await jwt.decode({ token: cookie.value, secret, salt: cookie.name });
    check(claims?.id === item.userId && JSON.stringify(claims.roles) === JSON.stringify(actor.roles) &&
      claims.sessionVersion === actor.sessionVersion, "SESSION_CLAIMS_MISMATCH");
    check(Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp) && claims.exp - claims.iat === 900 &&
      claims.exp > Math.floor(Date.now() / 1000) && claims.iat <= Math.floor(Date.now() / 1000) + 30, "SESSION_TTL_INVALID");
    const companionCookie = { ...cookie, name: "authjs.session-token",
      value: await jwt.encode({ token: { ...claims }, secret, salt: "authjs.session-token", maxAge: 900 }), secure: true };
    check(typeof companionCookie.value === "string" && companionCookie.value.length > 0 && !seen.has(companionCookie.value), "COMPANION_TOKEN_INVALID");
    seen.add(companionCookie.value);
    paired.push({ role: item.role, userId: item.userId, cookie: { ...cookie }, companionCookie });
  }
  return { publicSummary: { ...result.publicSummary, cookieVariants: 2 }, privatePayload: { sessions: paired } };
}

export async function buildStageSessionBundle() {
  frozenSources();
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const contents = `
import { executeOwnedQa } from './work-shares-owned-fixtures.mjs';
import { encode, decode } from '@auth/core/jwt';
${validateStageSessionRequest.toString()}
${pairStageSessionCookies.toString()}
let result;
try {
  const raw=process.env.CRM_WORK_SHARES_QA_INPUT;
  delete process.env.CRM_WORK_SHARES_QA_INPUT;
  if(!raw || raw.length>98304 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error();
  const bytes=Buffer.from(raw,'base64');
  if(bytes.toString('base64')!==raw) throw new Error();
  const request=validateStageSessionRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  result=await executeOwnedQa(request);
  if(result.publicSummary?.status==='PASS') result=await pairStageSessionCookies(result,request.envelope.body.plan,process.env.AUTH_SECRET,{encode,decode});
} catch {
  result={publicSummary:{status:'STOP',code:'STAGE_SESSION_BRIDGE_FAILED'},privatePayload:null};
}
process.stdout.write(JSON.stringify(result));
process.exitCode=result.publicSummary?.status==='PASS'?0:1;
`;
  const built = await build({ stdin: { contents, resolveDir: dirname(HELPER), sourcefile: "work-shares-stage-sessions-entry.mjs", loader: "js" },
    bundle: true, write: false, platform: "node", format: "esm", target: "node22",
    external: ["@prisma/client", "@node-rs/argon2"], logLevel: "silent" });
  guard(built.outputFiles.length === 1 && built.outputFiles[0].contents.length <= 768 * 1024, "SESSION_BUNDLE_SIZE_INVALID");
  return Buffer.from(built.outputFiles[0].contents);
}

async function originalControl(directory) {
  localGuard();
  directory = privateDirectory(directory);
  const control = json(join(directory, "control.json"));
  guard(control.format === "pero-work-shares-stage-control/v1" && control.baseUrl === BASE, "CONTROL_FORMAT_INVALID");
  const original = validateSeal(control.initialSeal);
  guard(original.runnerSha256 === ORIGINAL_SHA && original.wrapperSha256 === WRAPPER_SHA &&
    original.source?.ownedHelperSha256 === HELPER_SHA, "ORIGINAL_CONTROL_SEAL_CHANGED");
  // Delegate source/schema/migrations/helper/bundle checks to the frozen runner.
  // It writes only a nonsecret source proof; it performs no transport or DB call.
  const proofFile = join(directory, `session-bridge-source-${randomUUID()}.json`);
  await createOriginalSeal({ expectedRevision: original.expectedRevision, outputFile: proofFile });
  guard(same(json(proofFile), original), "ORIGINAL_CONTROL_SOURCE_CHANGED");
  return { directory, original };
}

/** Root explicitly creates this seal; no secret/checkpoint copying or mutation. */
export async function createStageBrowserSessionSeal(input) {
  try {
    guard(input && same(Object.keys(input).sort(), ["directory", "outputFile", "sealFile"]), "SESSION_SEAL_ARGUMENTS_INVALID");
    const { directory, original } = await originalControl(input.directory);
    const feature = validateSeal(json(input.sealFile));
    guard(same({ ...feature, expectedRevision: original.expectedRevision }, original), "FEATURE_SEAL_SOURCE_CHANGED");
    guard(isAbsolute(input.outputFile) && realpathSync(dirname(input.outputFile)).toLowerCase() === directory.toLowerCase(), "SEAL_INSIDE_PRIVATE_CONTROL_REQUIRED");
    const checked = json(join(directory, "migration-checked.json"));
    guard(checked.identity?.hostname === "crm-staging" && checked.identity.revision === feature.expectedRevision &&
      checked.publicSummary?.operation === "migration-check" && checked.publicSummary.status === "PASS", "MIGRATION_ACCEPTANCE_REQUIRED");
    const bundle = await buildStageSessionBundle();
    const seal = { ...feature, runnerSha256: hashFile(SELF), bundleSha256: sha(bundle) };
    saveProof(input.outputFile, seal);
    return { status: "PASS", operation: "session-seal", execution: "NOT_RUN", expectedRevision: seal.expectedRevision,
      sealSha256: hashFile(input.outputFile), runnerSha256: seal.runnerSha256, bundleSha256: seal.bundleSha256 };
  } catch (error) { throw new StageSessionsStop(safeCode(error)); }
}

function readEnvelope(directory, name) {
  const file = join(directory, name), bytes = read(file), envelope = JSON.parse(bytes.toString("utf8"));
  guard(sha(bytes) === envelopeSha256(envelope), "ENVELOPE_CANONICAL_READBACK_REQUIRED");
  return envelope;
}
function safeIoCode(error) { return ["ENOENT", "EACCES", "EPERM", "EPIPE", "ECONNRESET", "EINVAL", "UNKNOWN"].includes(error?.code) ? error.code : "IO_ERROR"; }
async function sessionTransport(packet, directory) {
  guard(packet.operation === "sessions" && packet.input?.operation === "sessions" && packet.input.target === "staging", "SESSION_TRANSPORT_ONLY");
  const executable = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
  const stat = lstatSync(executable);
  guard(stat.isFile() && !stat.isSymbolicLink() && realpathSync(executable).toLowerCase() === executable.toLowerCase(), "WINDOWS_OPENSSH_IDENTITY_REQUIRED");
  const wire = JSON.stringify(packet);
  guard(Buffer.byteLength(wire) <= 2 * 1024 * 1024, "PACKET_TOO_LARGE");
  const output = createBoundedCapture(2 * 1024 * 1024), errors = createBoundedCapture(128 * 1024);
  const result = await new Promise((finish) => {
    let child;
    try {
      child = spawn(executable, ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "crm-staging", "python3", `/root/pero-work-shares-${WRAPPER_SHA}.py`],
        { windowsHide: true, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) { finish({ code: null, signal: null, spawnErrorCode: safeIoCode(error), stdinErrorCode: null }); return; }
    let spawnErrorCode = null, stdinErrorCode = null;
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", (error) => { spawnErrorCode = safeIoCode(error); });
    child.stdin.on("error", (error) => { stdinErrorCode = safeIoCode(error); });
    child.once("close", (code, signal) => finish({ code, signal, spawnErrorCode, stdinErrorCode }));
    // The frozen remote wrapper supervises its child and W07 lock. No outer kill.
    child.stdin.end(wire);
  });
  const stdout = output.snapshot(), stderr = errors.snapshot();
  const diagnostics = { exitCode: Number.isInteger(result.code) ? result.code : null,
    signal: typeof result.signal === "string" && /^SIG[A-Z0-9]{1,16}$/.test(result.signal) ? result.signal : null,
    spawnErrorCode: result.spawnErrorCode, stdinErrorCode: result.stdinErrorCode,
    stdoutBytes: stdout.totalBytes, stderrBytes: stderr.totalBytes, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated,
    rawCapture: "SESSION_MEMORY_ONLY" };
  saveProof(join(directory, `session-bridge-${packet.attemptId}-transport.json`), diagnostics);
  try {
    guard(!result.spawnErrorCode && !result.stdinErrorCode && !stdout.truncated && !stderr.truncated, "SESSION_TRANSPORT_UNKNOWN");
    const body = JSON.parse(stdout.bytes.toString("utf8"));
    const stopped = body.publicSummary?.status === "STOP" ? body.publicSummary : body.result?.publicSummary?.status === "STOP" ? body.result.publicSummary : null;
    if (stopped) throw new StageSessionsStop(/^[A-Z][A-Z0-9_]{2,100}$/.test(stopped.code ?? "") ? stopped.code : "SESSION_UNSAFE_FAILURE");
    guard(body.attemptId === packet.attemptId && body.operation === "sessions" && body.identity?.hostname === "crm-staging" &&
      body.identity.revision === packet.seal.expectedRevision && result.code === 0 && !result.signal, "SESSION_RESPONSE_IDENTITY_MISMATCH");
    const summary = body.result?.publicSummary;
    guard(summary?.status === "PASS" && summary.operation === "sessions" && summary.runId === packet.input.envelope.body.plan.runId &&
      summary.count === 3 && summary.ttlSeconds === 900 && summary.cookieVariants === 2, "SESSION_RESPONSE_INVALID");
    saveProof(join(directory, `session-bridge-${packet.attemptId}-public.json`), { identity: body.identity, publicSummary: summary, transport: diagnostics });
    return { ...body.result, identity: body.identity, transport: diagnostics };
  } catch (error) { throw new StageSessionsStop(safeCode(error), diagnostics); }
}

export async function getStageBrowserSessions(input) {
  try {
    guard(input && same(Object.keys(input).sort(), ["directory", "sealFile"]), "SESSION_ARGUMENTS_INVALID");
    const { directory, original } = await originalControl(input.directory);
    const seal = validateSeal(json(input.sealFile));
    const bundle = await buildStageSessionBundle();
    guard(same({ ...seal, expectedRevision: original.expectedRevision, runnerSha256: original.runnerSha256, bundleSha256: original.bundleSha256 }, original) &&
      seal.runnerSha256 === hashFile(SELF) && seal.bundleSha256 === sha(bundle), "SESSION_SEAL_SOURCE_CHANGED");
    const checked = json(join(directory, "migration-checked.json"));
    guard(checked.identity?.hostname === "crm-staging" && checked.identity.revision === seal.expectedRevision &&
      checked.publicSummary?.operation === "migration-check" && checked.publicSummary.status === "PASS", "MIGRATION_ACCEPTANCE_REQUIRED");
    for (const name of ["browser-drained.json", "captured.json", "cleanup-intent.json", "cleaned.json"])
      guard(!existsSync(join(directory, name)), "BROWSER_ACTIONS_ALREADY_DRAINED");
    // Only now may private prepared/plan envelopes be read; original control and
    // every reviewed source digest have already passed the frozen runner checks.
    const prepared = readEnvelope(directory, "prepared.json"), planned = readEnvelope(directory, "plan.json");
    const outcome = json(join(directory, "prepare-outcome.json"));
    guard(prepared.body?.phase === "PREPARED" && planned.body?.phase === "PLANNED" && same(prepared.body.plan, planned.body.plan) &&
      outcome.outcome === "PASS" && outcome.publicSummary?.phase === "PREPARED" && outcome.publicSummary.runId === prepared.body.plan.runId, "PREPARED_CHECKPOINT_REQUIRED");
    const request = validateStageSessionRequest({ operation: "sessions", target: "staging", baseUrl: BASE, envelope: prepared });
    const attemptId = randomUUID();
    const sealSha256 = hashFile(input.sealFile), controlSha256 = hashFile(join(directory, "control.json"));
    saveProof(join(directory, `session-bridge-${attemptId}-intent.json`), { operation: "sessions", attemptId,
      expectedRevision: seal.expectedRevision, preparedSha256: envelopeSha256(prepared), sealSha256, at: new Date().toISOString() });
    const result = await sessionTransport({ seal, operation: "sessions", attemptId, input: request, bundle: bundle.toString("base64") }, directory);
    frozenSources();
    guard(hashFile(join(directory, "prepared.json")) === envelopeSha256(prepared) &&
      hashFile(input.sealFile) === sealSha256 && hashFile(SELF) === seal.runnerSha256 && hashFile(join(directory, "control.json")) === controlSha256,
      "SESSION_CHECKPOINT_CHANGED");
    for (const name of ["browser-drained.json", "captured.json", "cleanup-intent.json", "cleaned.json"])
      guard(!existsSync(join(directory, name)), "BROWSER_ACTIONS_ALREADY_DRAINED");
    return result;
  } catch (error) { throw new StageSessionsStop(safeCode(error), error instanceof StageSessionsStop ? error.transport : undefined); }
}

/** Synthetic JWT verification only. Never invokes transport, DB or local server. */
export async function selfTestStageSessionBridge() {
  const { default: assert } = await import("node:assert/strict");
  const jwt = await import("@auth/core/jwt");
  const secret = "synthetic-test-secret-with-at-least-32-characters";
  const plan = { runId: "synthetic-run", target: { kind: "EXISTING_STAGING" },
    manager: { id: "synthetic-manager", roles: ["MANAGER"], sessionVersion: 2 },
    users: [{ id: "synthetic-worker", roles: ["WORKER"], sessionVersion: 0 }, { id: "synthetic-mounter", roles: ["MOUNTER"], sessionVersion: 0 }] };
  const request = { operation: "sessions", target: "staging", baseUrl: BASE, envelope: { body: { phase: "PREPARED", plan } } };
  const actors = [plan.manager, ...plan.users];
  const result = { publicSummary: { status: "PASS", operation: "sessions", runId: plan.runId, count: 3, ttlSeconds: 900, passwordLogin: "NOT_TESTED" },
    privatePayload: { sessions: await Promise.all(actors.map(async (actor, index) => ({ role: ["manager", "worker", "mounter"][index], userId: actor.id,
      cookie: { name: "__Secure-authjs.session-token", value: await jwt.encode({ token: { id: actor.id, roles: actor.roles, sessionVersion: actor.sessionVersion },
        secret, salt: "__Secure-authjs.session-token", maxAge: 900 }), domain: "staging-crm.peromebel.by", path: "/", httpOnly: true, secure: true, sameSite: "Lax" } }))) } };
  const before = structuredClone(result);
  const paired = await pairStageSessionCookies(result, plan, secret, jwt);
  let checks = 0;
  for (let index = 0; index < 3; index++) {
    const item = paired.privatePayload.sessions[index];
    assert.ok(item.companionCookie?.name === "authjs.session-token", "secure and companion cookie must both be present");
    const claims = await jwt.decode({ token: item.companionCookie.value, secret, salt: item.companionCookie.name });
    assert.ok(claims?.id === actors[index].id && same(claims.roles, actors[index].roles) && claims.sessionVersion === actors[index].sessionVersion);
    assert.ok(claims.exp - claims.iat === 900 && item.companionCookie.secure === true);
    assert.ok(item.cookie.value === before.privatePayload.sessions[index].cookie.value && item.companionCookie.value !== item.cookie.value);
    checks++;
  }
  assert.ok(same(result, before), "input cookies must remain unchanged");
  checks++;
  for (const change of [{ operation: "cleanup" }, { operation: "prepare" }, { target: "local" }, { target: "production" },
    { baseUrl: "https://crm.peromebel.by" }, { authSecret: "override" }, { envelope: { body: { phase: "CAPTURED", plan } } }]) {
    assert.throws(() => validateStageSessionRequest({ ...request, ...change }));
    checks++;
  }
  for (const change of [{ userId: "foreign-user" }, { role: "admin" },
    ...[{ domain: "crm.peromebel.by" }, { name: "authjs.session-token" }, { secure: false }].map((scope) => ({ cookie: { ...before.privatePayload.sessions[0].cookie, ...scope } }))]) {
    const invalid = structuredClone(before); Object.assign(invalid.privatePayload.sessions[0], change);
    await assert.rejects(pairStageSessionCookies(invalid, plan, secret, jwt));
    checks++;
  }
  for (const change of [{ id: "foreign-user" }, { roles: ["ADMIN"] }, { sessionVersion: 3 }]) {
    const wrongClaims = structuredClone(before);
    wrongClaims.privatePayload.sessions[0].cookie.value = await jwt.encode({ token: { ...plan.manager, ...change }, secret, salt: "__Secure-authjs.session-token", maxAge: 900 });
    await assert.rejects(pairStageSessionCookies(wrongClaims, plan, secret, jwt));
    checks++;
  }
  const wrongSalt = structuredClone(before);
  wrongSalt.privatePayload.sessions[0].cookie.value = await jwt.encode({ token: { ...plan.manager }, secret, salt: "authjs.session-token", maxAge: 900 });
  await assert.rejects(pairStageSessionCookies(wrongSalt, plan, secret, jwt));
  checks++;
  await assert.rejects(pairStageSessionCookies(before, plan, "different-secret-with-at-least-32-characters", jwt));
  checks++;
  const wrongTtl = structuredClone(before);
  wrongTtl.privatePayload.sessions[0].cookie.value = await jwt.encode({ token: { ...plan.manager }, secret, salt: "__Secure-authjs.session-token", maxAge: 60 });
  await assert.rejects(pairStageSessionCookies(wrongTtl, plan, secret, jwt));
  checks++;
  await assert.rejects(getStageBrowserSessions({ directory: "never-accessed", sealFile: "never-accessed", operation: "cleanup" }), /SESSION_ARGUMENTS_INVALID/);
  checks++;
  return { status: "PASS", checks, scope: "SYNTHETIC_CRYPTO_ONLY", transport: "NOT_RUN" };
}
