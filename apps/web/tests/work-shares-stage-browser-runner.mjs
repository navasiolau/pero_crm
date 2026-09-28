/**
 * Root opt-in CLI, from apps/web:
 *   node tests/work-shares-stage-browser-runner.mjs browser <controlDir> <featureSeal>
 * Requires successful migration-check / plan / prepare. One full browser attempt;
 * no automatic retry, capture, cleanup, deployment, migration or credential log.
 * Intent + owner-private output directory are durable BEFORE requesting sessions.
 * Browser artifacts contain the detailed safe receipt; this CLI prints counts and
 * constant codes only. Sessions and staging Basic Auth remain in process memory.
 * SAFETY: D:\Projects\pero_infra\infra-recovery\SAFETY-RULES.md. STOP on mismatch.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync,
  realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalEnvelope, envelopeSha256 } from "./work-shares-owned-fixtures.mjs";
import { recordActionsDrained, stageOperation, StageStop, validateSeal } from "./work-shares-stage-runner.mjs";
import { runWorkSharesBrowser, validateWorkSharesBrowserInput, WorkSharesBrowserStop } from "./work-shares-browser.mjs";

const SELF = fileURLToPath(import.meta.url);
const WEB = resolve(dirname(SELF), "..");
const ROOT = resolve(WEB, "../..");
const BASE = "https://staging-crm.peromebel.by";
const HANDOVER = "D:/Projects/pero_crm_v2/HANDOVER-NEXT-AGENT.md";
const OUTPUT_PREFIX = "pero-work-shares-qa-staging-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export class StageBrowserStop extends Error {
  constructor(code) { super(code); this.name = "StageBrowserStop"; this.code = code; }
}
function guard(value, code) { if (!value) throw new StageBrowserStop(code); }
function safeCode(error) {
  return (error instanceof StageBrowserStop || error instanceof StageStop || error instanceof WorkSharesBrowserStop) &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code ?? "") ? error.code : "STAGE_BROWSER_FAILED_INSPECT_STATE";
}
function read(path) {
  const info = lstatSync(path);
  guard(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 2 * 1024 * 1024, "PRIVATE_FILE_INVALID");
  return readFileSync(path);
}
const json = (path) => JSON.parse(read(path).toString("utf8"));
function save(path, value) {
  const bytes = Buffer.from(canonicalEnvelope(value));
  const descriptor = openSync(path, "wx", 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  guard(hash(read(path)) === hash(bytes), "DURABLE_READBACK_FAILED");
}
function localEnv(extra = {}) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "username", "userdomain", "programdata", "allusersprofile"]);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), ...extra };
}
function ownerSid() {
  const output = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, env: localEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const matches = output.match(/S-1-\d+(?:-\d+)+/g);
  guard(matches?.length === 1, "PRIVATE_OWNER_REQUIRED");
  return matches[0];
}
function privateDirectory(path, prefix, sid) {
  guard(isAbsolute(path), "ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED");
  const info = lstatSync(path), real = realpathSync(path);
  guard(info.isDirectory() && !info.isSymbolicLink() && dirname(real).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    basename(real).startsWith(prefix), "PRIVATE_TEMP_DIRECTORY_REQUIRED");
  const script = "$a=Get-Acl -LiteralPath $env:CRM_QA_ACL_DIR; [pscustomobject]@{protected=$a.AreAccessRulesProtected;rules=@($a.Access | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();inherited=$_.IsInherited} })} | ConvertTo-Json -Compress -Depth 4";
  const acl = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, env: localEnv({ CRM_QA_ACL_DIR: real }), stdio: ["ignore", "pipe", "pipe"] }));
  const allowed = new Set([sid, "S-1-5-18", "S-1-5-32-544"]);
  guard(acl.protected === true && Array.isArray(acl.rules) && acl.rules.length > 0 &&
    acl.rules.every((rule) => allowed.has(rule.sid) && rule.type === "Allow" && !rule.inherited), "PRIVATE_DIRECTORY_ACL_REQUIRED");
  return real;
}

/** Same fixed source/field convention as staging-first-wave-runner.mjs. */
export function parseStagingBasicAuth(text) {
  guard(typeof text === "string", "BASIC_CREDENTIAL_SOURCE_INVALID");
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith("- Basic auth staging:"));
  guard(lines.length === 1, "BASIC_CREDENTIAL_SOURCE_INVALID");
  const fields = [...lines[0].matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  guard(fields.length === 3 && fields[0] && fields[1], "BASIC_CREDENTIAL_SOURCE_INVALID");
  return { username: fields[0], password: fields[1] };
}

export function minimalBrowserPlan(full) {
  guard(full?.target?.kind === "EXISTING_STAGING" && UUID.test(full.runId ?? ""), "STAGING_PREPARED_PLAN_REQUIRED");
  return { runId: full.runId,
    project: { id: full.project.id, number: full.project.number, title: full.project.title },
    work: { id: full.work.id, title: full.work.title },
    source: { id: full.source.id, title: full.source.title },
    dependent: { id: full.dependent.id, title: full.dependent.title },
    users: full.users.map(({ id, name, roles }) => ({ id, name, roles })),
    fractionalTitle: full.fractionalTitle, taskType: full.taskType, dueAt: full.dueAt, currency: full.currency };
}

export function confirmedDrainProof(proof, runId) {
  return Boolean(proof && proof.version === 1 && proof.runId === runId && UUID.test(runId) &&
    proof.actionsDrained === true && proof.contextsClosed === true && proof.browserClosed === true &&
    proof.interceptsPending === 0 && proof.uncertainMutation === false);
}

export async function runStageBrowser({ controlDir, featureSeal }) {
  guard(process.platform === "win32" && realpathSync(ROOT).toLowerCase() === "d:\\projects\\pero_crm_worktrees\\universal-work-shares" &&
    realpathSync(process.cwd()).toLowerCase() === realpathSync(WEB).toLowerCase(), "REVIEWED_WORKTREE_AND_CWD_REQUIRED");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "DIRECT_URL"])
    guard(!process.env[key], "AMBIENT_OVERRIDE_FORBIDDEN");
  const sid = ownerSid();
  const directory = privateDirectory(controlDir, "pero-work-shares-stage-", sid);
  guard(isAbsolute(featureSeal), "ABSOLUTE_FEATURE_SEAL_REQUIRED");
  const seal = validateSeal(json(featureSeal));
  const checked = json(join(directory, "migration-checked.json"));
  const preparedFile = join(directory, "prepared.json");
  const preparedBytes = read(preparedFile);
  const prepared = JSON.parse(preparedBytes.toString("utf8"));
  const original = json(join(directory, "plan.json"));
  guard(checked.identity?.revision === seal.expectedRevision && checked.publicSummary?.status === "PASS" &&
    json(join(directory, "prepare-outcome.json")).outcome === "PASS", "STAGING_MIGRATION_AND_PREPARE_REQUIRED");
  guard(hash(preparedBytes) === envelopeSha256(prepared) && prepared.body?.phase === "PREPARED" &&
    canonicalEnvelope(prepared.body.plan) === canonicalEnvelope(original.body.plan), "PREPARED_CHECKPOINT_INVALID");
  for (const file of ["browser-stage-intent.json", "browser-stage-result.json", "browser-drained.json", "captured.json", "cleanup-intent.json", "cleaned.json"])
    guard(!existsSync(join(directory, file)), "BROWSER_ALREADY_ATTEMPTED_OR_FINISHED");
  const plan = minimalBrowserPlan(prepared.body.plan);
  let credentials = parseStagingBasicAuth(read(HANDOVER).toString("utf8"));
  const outputDir = mkdtempSync(join(tmpdir(), OUTPUT_PREFIX));
  execFileSync("icacls", [outputDir, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
    { windowsHide: true, env: localEnv(), stdio: "pipe" });
  privateDirectory(outputDir, OUTPUT_PREFIX, sid);
  save(join(directory, "browser-stage-intent.json"), { operation: "browser", runId: plan.runId, outputDir,
    expectedRevision: seal.expectedRevision, preparedSha256: hash(preparedBytes), sealSha256: hash(read(featureSeal)),
    runnerSha256: hash(read(SELF)), browserHelperSha256: hash(read(join(dirname(SELF), "work-shares-browser.mjs"))),
    at: new Date().toISOString(), automaticRetry: false });

  let sessionResult, receipt;
  let code = null;
  let drain = "MISSING";
  let browserStarted = false;
  try {
    sessionResult = await stageOperation({ operation: "sessions", directory, sealFile: featureSeal });
    guard(sessionResult.publicSummary?.status === "PASS" && sessionResult.publicSummary.runId === plan.runId &&
      hash(read(preparedFile)) === hash(preparedBytes), "SESSION_PREPARED_BINDING_CHANGED");
    const sessions = sessionResult.privatePayload?.sessions;
    validateWorkSharesBrowserInput({ baseUrl: BASE, plan, sessions });
    browserStarted = true;
    receipt = await runWorkSharesBrowser({ baseUrl: BASE, outputDir, plan, sessions, httpCredentials: credentials });
    guard(receipt?.status === "PASS" && receipt.runId === plan.runId, "BROWSER_ACCEPTANCE_FAILED");
  } catch (error) {
    code = safeCode(error);
    if (error instanceof WorkSharesBrowserStop) receipt = error.receipt;
  } finally {
    // The actual browser module owns closure/queue drain. Never infer it from
    // success, thrown error, process exit, an absent browser, or elapsed time.
    const proofFile = join(outputDir, "browser-drained.json");
    if (existsSync(proofFile)) {
      try {
        const proof = json(proofFile);
        if (confirmedDrainProof(proof, plan.runId)) {
          recordActionsDrained({ directory, browserProofFile: proofFile });
          drain = "RECORDED";
        } else { drain = "UNCONFIRMED"; code ??= "BROWSER_DRAIN_UNCONFIRMED"; }
      } catch (error) { drain = "RECORD_FAILED"; code ??= safeCode(error); }
    } else code ??= "BROWSER_DRAIN_PROOF_MISSING";
    sessionResult = null;
    credentials = null;
  }
  const result = { status: code ? "FAIL" : "PASS", operation: "browser", code, runId: plan.runId,
    expectedRevision: seal.expectedRevision, outputDir, browserStarted, drain,
    checks: Array.isArray(receipt?.checks) ? receipt.checks.length : 0,
    actions: Array.isArray(receipt?.actions) ? receipt.actions.length : 0,
    screenshots: Array.isArray(receipt?.screenshots) ? receipt.screenshots.length : 0,
    authentication: "SIGNED_STAGING_SESSIONS", passwordLogin: "NOT_TESTED", tlsVerification: "ENABLED",
    capture: "NOT_RUN", cleanup: "NOT_RUN", automaticRetry: false, completedAt: new Date().toISOString() };
  save(join(directory, "browser-stage-result.json"), result);
  return result;
}

async function main() {
  const [operation, controlDir, featureSeal, ...extra] = process.argv.slice(2);
  guard(operation === "browser" && controlDir && featureSeal && extra.length === 0, "EXPLICIT_BROWSER_ARGUMENTS_REQUIRED");
  const result = await runStageBrowser({ controlDir, featureSeal });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status !== "PASS") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((error) => {
  process.stdout.write(JSON.stringify({ status: "STOP", operation: "browser", code: safeCode(error), automaticRetry: false }) + "\n");
  process.exitCode = 1;
});
