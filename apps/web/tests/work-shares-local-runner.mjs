/** Root-owned opt-in coordinator. Existing local DB only; no migration/seed/reset. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { APPROVED, assertContainerIdentity } from "./work-shares-local-migrate.mjs";
import { canonicalEnvelope, envelopeSha256, executeOwnedQa, openEnvelope } from "./work-shares-owned-fixtures.mjs";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "../..");
const BASE = "http://localhost:3105";
const PREFIX = "pero-work-shares-qa-local-";
const require = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
function privateTempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-\d+(?:-\d+)+/g);
  assert.equal(sid?.length, 1, "PRIVATE_DIRECTORY_OWNER_REQUIRED");
  execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], { windowsHide: true, stdio: "pipe" });
  return directory;
}
function save(file, value) {
  const bytes = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  assert.equal(sha(readFileSync(file)), sha(bytes), "DURABLE_FILE_READBACK_FAILED");
  return file;
}
function sourceGuard() {
  assert.equal(process.platform, "win32");
  assert.equal(realpathSync(ROOT).toLowerCase(), APPROVED.root.toLowerCase());
  assert.equal(realpathSync(process.cwd()).toLowerCase(), WEB.toLowerCase());
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DOCKER_HOST", "DOCKER_CONFIG", "DOTENV_CONFIG_PATH", "DIRECT_URL", "PGOPTIONS", "PGSERVICE"]) assert.ok(!process.env[key], "ENV_OVERRIDE_FORBIDDEN");
  for (const dir of [ROOT, WEB]) for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"]) assert.ok(!existsSync(join(dir, name)), "AMBIENT_DOTENV_FORBIDDEN");
}
function localTarget() {
  sourceGuard();
  const [context] = JSON.parse(execFileSync("docker", ["context", "inspect", "desktop-linux"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
  assert.equal(context.Endpoints?.docker?.Host, "npipe:////./pipe/dockerDesktopLinuxEngine");
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", APPROVED.containerId], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
  const identity = assertContainerIdentity(container);
  const password = container.Config.Env.find((value) => value.startsWith("POSTGRES_PASSWORD=")).slice(18);
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = "pero"; url.password = password;
  return { identity, dsn: url.href };
}
function readState(directory, target) {
  assert.ok(isAbsolute(directory));
  const real = realpathSync(directory);
  assert.equal(dirname(real).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(real.split(/[\\/]/).at(-1).startsWith(PREFIX));
  const file = join(real, "state.json");
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  const state = read(file);
  assert.equal(state.kind, "EXISTING_LOCAL");
  assert.equal(state.baseUrl, BASE);
  assert.deepEqual(state.identity, target.identity, "LOCAL_CONTAINER_DRIFT");
  assert.ok(typeof state.secret === "string" && state.secret.length >= 32);
  return { directory: real, state };
}
function runtimeEnv(target, state) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath", "appdata", "localappdata", "temp", "tmp"]);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))),
    NODE_ENV: "production", DATABASE_URL: target.dsn, AUTH_SECRET: state.secret, AUTH_URL: BASE,
    AUTH_TRUST_HOST: "true", NEXT_TELEMETRY_DISABLED: "1", NO_COLOR: "1" };
}
async function operation(name, directory, state, extra = {}) {
  process.env.CRM_LOCAL_CONTAINER_ID = APPROVED.containerId;
  const envelope = name === "plan" ? undefined : read(join(directory, name === "prepare" || !existsSync(join(directory, "prepared.json")) ? "plan.json" : "prepared.json"));
  const request = { operation: name, target: "local", ...(envelope ? { envelope } : {}), ...extra };
  if (name === "prepare") request.durablePlanSha256 = envelopeSha256(envelope);
  if (name === "cleanup") {
    const captured = read(join(directory, "captured.json"));
    const drained = read(join(directory, "browser-drained.json"));
    assert.equal(drained.actionsDrained, true);
    if (existsSync(join(directory, "completion-started.json"))) assert.equal(read(join(directory, "completion-drained.json")).actionsDrained, true);
    for (const file of readdirSync(directory).filter((file) => /^completion-attempt-[0-9a-f-]+\.json$/.test(file))) {
      const attempt = read(join(directory, file));
      const outputDir = realpathSync(attempt.outputDir);
      assert.equal(dirname(outputDir).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
      assert.ok(outputDir.split(/[\\/]/).at(-1).startsWith(PREFIX));
      const proof = read(join(outputDir, "completion-drained.json"));
      assert.equal(proof.runId, captured.body.plan.runId);
      assert.equal(proof.actionsDrained, true);
    }
    request.envelope = captured;
    request.durableCheckpointSha256 = envelopeSha256(captured);
    request.actionsDrained = true;
  }
  if (["prepare", "cleanup"].includes(name)) save(join(directory, `${name}-intent.json`), { at: new Date().toISOString(), envelopeSha256: envelopeSha256(request.envelope) });
  const result = await executeOwnedQa(request, { authSecret: state.secret });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  save(join(directory, `${name}-${stamp}-public.json`), result.publicSummary);
  console.log(JSON.stringify(result.publicSummary));
  assert.equal(result.publicSummary.status, "PASS", `QA_${name.toUpperCase()}_STOP`);
  const files = { plan: "plan.json", prepare: "prepared.json", capture: "captured.json", cleanup: "cleaned.json" };
  if (files[name]) {
    const value = result.privatePayload.envelope;
    save(join(directory, files[name]), canonicalEnvelope(value));
    assert.equal(sha(readFileSync(join(directory, files[name]))), envelopeSha256(value));
  } else if (name === "inspect") save(join(directory, `inspect-${stamp}-private.json`), result.privatePayload);
  return result;
}
async function main() {
  const name = process.argv[2];
  assert.ok(["init", "serve", "plan", "prepare", "inspect", "capture", "browser", "completion", "cleanup"].includes(name));
  const target = localTarget();
  if (name === "init") {
    const client = new Client({ connectionString: target.dsn, options: "-c default_transaction_read_only=on" });
    await client.connect();
    try {
      const { rows: [identity] } = await client.query("SELECT current_database() AS name,current_user AS username,current_setting('transaction_read_only') AS readonly");
      assert.deepEqual(identity, { name: "pero_crm", username: "pero", readonly: "on" });
      const { rows: [migration] } = await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [APPROVED.migration]);
      assert.equal(migration.count, 1, "APPLY_REVIEWED_LOCAL_MIGRATION_FIRST");
    } finally { await client.end(); }
    const directory = privateTempDirectory();
    save(join(directory, "state.json"), { kind: "EXISTING_LOCAL", baseUrl: BASE, identity: target.identity, secret: randomBytes(48).toString("base64url") });
    console.log(JSON.stringify({ status: "PASS", operation: "init", directory, baseUrl: BASE, writes: "PRIVATE_LOCAL_STATE_ONLY" }));
    return;
  }
  const { directory, state } = readState(process.argv[3], target);
  if (name === "serve") {
    assert.ok(existsSync(join(WEB, ".next", "BUILD_ID")), "PRODUCTION_BUILD_REQUIRED");
    assert.ok(!existsSync(join(directory, "runtime.json")) && !existsSync(join(directory, "runtime-intent.json")), "RUNTIME_ALREADY_ATTEMPTED");
    save(join(directory, "runtime-intent.json"), { baseUrl: BASE, at: new Date().toISOString(), cwd: WEB });
    const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3105"], { cwd: WEB, env: runtimeEnv(target, state), windowsHide: true, stdio: "inherit" });
    const completed = new Promise((res) => {
      child.once("error", () => res({ code: null, spawnFailed: true }));
      child.once("exit", (code) => res({ code, spawnFailed: false }));
    });
    let requestedStop = false;
    const interrupt = () => { requestedStop = true; child.kill("SIGINT"); };
    const terminate = () => { requestedStop = true; child.kill("SIGTERM"); };
    process.once("SIGINT", interrupt); process.once("SIGTERM", terminate);
    try {
      try { save(join(directory, "runtime.json"), { pid: child.pid, baseUrl: BASE, startedAt: new Date().toISOString() }); }
      catch (error) {
        // The child belongs to this exact spawn; never search or kill by port/name.
        if (child.pid && child.exitCode === null) {
          child.kill("SIGTERM");
          const closed = await Promise.race([completed, new Promise((res) => setTimeout(() => res(null), 3000))]);
          if (!closed && child.exitCode === null) execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "pipe" });
        }
        await completed;
        throw error;
      }
      const result = await completed;
      save(join(directory, "runtime-stopped.json"), { pid: child.pid, ...result, requestedStop, at: new Date().toISOString() });
      assert.ok(!result.spawnFailed && (result.code === 0 || requestedStop), "RUNTIME_EXIT_UNEXPECTED");
    } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate); }
    return;
  }
  if (name === "browser" || name === "completion") {
    const result = await operation("sessions", directory, state, { baseUrl: BASE });
    const { runWorkSharesBrowser, runWorkSharesBrowserCompletion } = await import("./work-shares-browser.mjs");
    const fullPlan = read(join(directory, "plan.json")).body.plan;
    const plan = { runId: fullPlan.runId, project: { id: fullPlan.project.id, number: fullPlan.project.number, title: fullPlan.project.title },
      work: { id: fullPlan.work.id, title: fullPlan.work.title }, source: fullPlan.source, dependent: fullPlan.dependent,
      users: fullPlan.users.map(({ id, name, roles }) => ({ id, name, roles })), fractionalTitle: fullPlan.fractionalTitle,
      taskType: fullPlan.taskType, dueAt: fullPlan.dueAt, currency: fullPlan.currency };
    if (name === "completion") {
      assert.ok(!existsSync(join(directory, "completion-result.json")), "COMPLETION_ALREADY_ACCEPTED");
      const captured = openEnvelope(read(join(directory, "captured.json")), state.secret);
      const previous = read(join(directory, "browser-receipt.json"));
      assert.equal(captured.phase, "CAPTURED");
      assert.equal(captured.plan.runId, fullPlan.runId);
      assert.equal(previous.runId, fullPlan.runId);
      assert.equal(previous.actionsDrained, true);
      assert.equal(captured.observations.dataChecks, "PASS");
      assert.equal(captured.observations.settlementComplete, true);
      for (const role of ["source", "dependent", "fractional", "child"]) {
        assert.equal(captured.observations.tasks[role].status, "DONE");
        assert.equal(captured.observations.tasks[role].id, previous.capturedIds[role]);
      }
      assert.ok(captured.ownership.keys.ChangeLog.some(([id]) => id === `task-split:${previous.capturedIds.splitRequestId}`));
      const outputDir = privateTempDirectory();
      save(join(directory, `completion-attempt-${randomUUID()}.json`), { runId: fullPlan.runId, outputDir, readonly: true, at: new Date().toISOString() });
      const receipt = await runWorkSharesBrowserCompletion({ baseUrl: BASE, outputDir, plan,
        sessions: result.privatePayload.sessions, capturedIds: previous.capturedIds });
      assert.equal(receipt.actionsDrained, true);
      save(join(directory, "completion-result.json"), { ...receipt, outputDir });
      console.log(JSON.stringify(receipt));
      return;
    }
    // The browser module writes its own drain proof only after successful closure.
    const receipt = await runWorkSharesBrowser({ baseUrl: BASE, outputDir: directory, plan, sessions: result.privatePayload.sessions });
    assert.equal(receipt.actionsDrained, true);
    assert.equal(read(join(directory, "browser-drained.json")).actionsDrained, true);
    save(join(directory, "browser-result.json"), receipt);
    console.log(JSON.stringify(receipt));
    return;
  }
  await operation(name, directory, state);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  // Do not print raw Prisma, argv or assertion values; these may contain secrets.
  console.error(JSON.stringify({ status: "STOP", operation: process.argv[2], error: error?.name ?? "Error", code: error?.code ?? "LOCAL_QA_FAILED_INSPECT_STATE" }));
  process.exitCode = 1;
});
