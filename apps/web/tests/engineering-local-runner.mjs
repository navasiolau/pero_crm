/** Local-only QA coordinator. No connection, Docker call or write on import. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { assertContainerIdentity } from "./work-shares-local-migrate.mjs";
import { assertEngineeringQaTarget, baselineEngineeringOwned, captureEngineeringOwned, cleanupEngineeringOwned,
  engineeringPlanSha256, engineeringPublicPlan, prepareEngineeringOwned, validateEngineeringPlan } from "./engineering-owned-fixtures.mjs";

const SELF = fileURLToPath(import.meta.url);
const WEB = resolve(dirname(SELF), "..");
const ROOT = resolve(WEB, "../..");
const EXPECTED_ROOT = "D:\\Projects\\pero_crm_worktrees\\product-engineering-pay";
const PREFIX = "pero-engineering-qa-local-";
const MIGRATION = "20260928220000_product_engineering_pay";
const TARGET = Object.freeze({ kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  host: "127.0.0.1", port: 5433, database: "pero_crm" });
const require = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
function stop(condition, code) { if (!condition) throw new Error(code); }
function equal(a, b, code) { stop(JSON.stringify(a) === JSON.stringify(b), code); }

export function assertEngineeringLocalSource({ platform, root, cwd, env = {} }) {
  stop(platform === "win32" && win32.resolve(root).toLowerCase() === win32.resolve(EXPECTED_ROOT).toLowerCase() &&
    win32.resolve(cwd).toLowerCase() === win32.resolve(EXPECTED_ROOT, "apps", "web").toLowerCase(), "SOURCE_NOT_APPROVED_WORKTREE");
  for (const key of ["DATABASE_URL", "DIRECT_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGOPTIONS", "PGSERVICE",
    "DOCKER_HOST", "DOCKER_CONFIG", "NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH"]) stop(!env[key], "AMBIENT_TARGET_OVERRIDE_FORBIDDEN");
  for (const directory of [ROOT, WEB]) for (const name of [".env", ".env.local", ".env.production", ".env.production.local",
    ".env.development", ".env.development.local"]) stop(!existsSync(join(directory, name)), "AMBIENT_DOTENV_FORBIDDEN");
  return true;
}
function sourceGuard() { return assertEngineeringLocalSource({ platform: process.platform, root: realpathSync(ROOT), cwd: realpathSync(process.cwd()), env: process.env }); }
function privateDirectory() {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-\d+(?:-\d+)+/g);
  stop(sid?.length === 1, "PRIVATE_DIRECTORY_OWNER_REQUIRED");
  execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
    { windowsHide: true, stdio: "pipe" });
  return directory;
}
function stateDirectory(input) {
  stop(typeof input === "string" && isAbsolute(input), "PRIVATE_STATE_PATH_REQUIRED");
  const directory = realpathSync(input);
  stop(dirname(directory).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    directory.split(/[\\/]/).at(-1).startsWith(PREFIX), "PRIVATE_STATE_PATH_FORBIDDEN");
  return directory;
}
function save(directory, name, value) {
  const file = join(directory, name);
  const bytes = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  const handle = openSync(file, "wx", 0o600);
  try { writeFileSync(handle, bytes, "utf8"); fsyncSync(handle); } finally { closeSync(handle); }
  stop(sha(readFileSync(file)) === sha(bytes), "DURABLE_READBACK_FAILED");
  return file;
}
function load(directory, name) {
  const file = join(directory, name);
  stop(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "DURABLE_FILE_MISSING_OR_LINK");
  return read(file);
}
export function inspectEngineeringLocalTarget() {
  sourceGuard();
  const [context] = JSON.parse(execFileSync("docker", ["context", "inspect", "desktop-linux"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
  stop(context?.Endpoints?.docker?.Host === "npipe:////./pipe/dockerDesktopLinuxEngine", "DOCKER_CONTEXT_MISMATCH");
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", TARGET.containerId],
    { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
  const identity = assertContainerIdentity(container);
  assertEngineeringQaTarget(TARGET);
  const env = Object.fromEntries(container.Config.Env.map((item) => { const at = item.indexOf("="); return [item.slice(0, at), item.slice(at + 1)]; }));
  stop(typeof env.POSTGRES_PASSWORD === "string" && env.POSTGRES_PASSWORD.length > 0, "DATABASE_PASSWORD_MISSING");
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = "pero"; url.password = env.POSTGRES_PASSWORD;
  return { identity, datasourceUrl: url.href };
}
export function assertEngineeringLocalDatasource(target) {
  let url;
  try { url = new URL(target?.datasourceUrl); } catch { throw new Error("LOCAL_DATASOURCE_FORBIDDEN"); }
  stop(target?.identity?.id === TARGET.containerId && target.identity.name === "/pero_crm_pg" &&
    target.identity.volume?.name === "pero_crm_v2_pgdata" && url.protocol === "postgresql:" &&
    url.hostname === TARGET.host && url.port === String(TARGET.port) && url.pathname === `/${TARGET.database}` &&
    decodeURIComponent(url.username) === "pero" && url.password.length > 0 && !url.search && !url.hash,
  "LOCAL_DATASOURCE_FORBIDDEN");
  return target;
}
export async function withEngineeringLocalDb(target, operation) {
  assertEngineeringLocalDatasource(target);
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: target.datasourceUrl, log: [] });
  try { return await operation(db); } finally { await db.$disconnect(); }
}
async function dbGuard(db) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const rows = await tx.$queryRawUnsafe("SELECT current_database() AS database,current_user AS username");
    equal(rows[0], { database: "pero_crm", username: "pero" }, "DATABASE_IDENTITY_MISMATCH");
    const migrations = await tx.$queryRawUnsafe('SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations"');
    stop(migrations.every((row) => row.finished_at !== null || row.rolled_back_at !== null) &&
      migrations.some((row) => row.migration_name === MIGRATION && row.finished_at !== null && row.rolled_back_at === null),
    "ENGINEERING_MIGRATION_NOT_APPLIED");
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 30000 });
}
function planData({ runId, managerId, clientId, users, baseline }) {
  const now = Date.now();
  const taskIds = [randomUUID(), randomUUID()];
  const projectNumber = `QA-ENG-${runId}`;
  return { format: "pero-engineering-owned-qa/v1", runId, target: TARGET, managerId, clientId, users, baseline,
    project: { id: randomUUID(), number: projectNumber, numberInt: -2000000000, title: `QA ${runId} engineering`, clientId, currency: "BYN" },
    product: { id: randomUUID(), number: `${projectNumber}-1`, title: `QA ${runId} product`, engineerId: users[0].id,
      expectedPrice: "10000.00", status: "DESIGN" },
    pool: { id: randomUUID() }, legacyWork: { id: randomUUID(), title: `QA ${runId} legacy`, quantity: "5.00", priceSnapshot: "100.00", total: "500.00" },
    legacyTasks: [{ id: taskIds[0], title: `QA ${runId} legacy A`, quantity: "2.00", assigneeId: users[0].id, status: "DONE",
      dueAt: new Date(now + 7 * 86400000).toISOString(), estimateMinutes: 60, doneAt: new Date(now).toISOString() },
    { id: taskIds[1], title: `QA ${runId} legacy B`, quantity: "3.00", assigneeId: users[0].id, status: "NEW",
      dueAt: new Date(now + 7 * 86400000).toISOString(), estimateMinutes: 60 }],
    historicalTimeEntry: { id: randomUUID(), taskId: taskIds[0], userId: users[0].id,
      startedAt: new Date(now - 3600000).toISOString(), stoppedAt: new Date(now).toISOString(), minutes: 60 },
    newWorkTitle: `QA ${runId} new engineering`, newWorkQuantity: "10.30" };
}

async function dry() {
  const target = inspectEngineeringLocalTarget();
  return withEngineeringLocalDb(target, async (db) => {
    await dbGuard(db);
    const [managers, client] = await Promise.all([
      db.user.findMany({ where: { active: true, roles: { has: "MANAGER" } }, select: { id: true, name: true, roles: true }, orderBy: { name: "asc" }, take: 8 }),
      db.client.findFirst({ select: { id: true, name: true, lastName: true, middleName: true }, orderBy: { id: "asc" } }),
    ]);
    return { status: "PASS", operation: "dry", target: TARGET, containerId: target.identity.id, managers,
      firstClient: client && { id: client.id, displayName: [client.lastName, client.name, client.middleName].filter(Boolean).join(" ") } };
  });
}

async function plan(managerId, clientId) {
  stop(typeof managerId === "string" && managerId.length > 0 && typeof clientId === "string" && clientId.length > 0, "MANAGER_AND_CLIENT_IDS_REQUIRED");
  const target = inspectEngineeringLocalTarget();
  return withEngineeringLocalDb(target, async (db) => {
    await dbGuard(db);
    const [manager, client, baseline] = await Promise.all([
      db.user.findUnique({ where: { id: managerId }, select: { id: true, active: true, roles: true, sessionVersion: true } }),
      db.client.findUnique({ where: { id: clientId }, select: { id: true } }),
      baselineEngineeringOwned(db, TARGET),
    ]);
    stop(manager?.active === true && manager.roles.includes("MANAGER") && client?.id === clientId, "REFERENCES_NOT_APPROVED");
    const runId = randomUUID();
    const roles = ["ENGINEER", "ENGINEER", "WORKER"];
    const { hash } = await import("@node-rs/argon2");
    const users = [];
    for (const [index, role] of roles.entries()) {
      const password = randomBytes(64);
      let passwordHash;
      try { passwordHash = await hash(password); } finally { password.fill(0); }
      users.push({ id: randomUUID(), email: `qa-eng-${runId}-${index}@qa.invalid`, name: `QA ${runId} ${role} ${index}`,
        roles: [role], payScheme: "PIECE", active: true, passwordHash });
    }
    const value = planData({ runId, managerId, clientId, users, baseline });
    validateEngineeringPlan(value);
    const directory = privateDirectory();
    save(directory, "target.json", { binding: TARGET, identity: target.identity });
    save(directory, "plan.json", value);
    save(directory, "plan-sha256.json", { value: engineeringPlanSha256(value) });
    equal(load(directory, "plan.json"), value, "PLAN_READBACK_MISMATCH");
    stop(load(directory, "plan-sha256.json").value === engineeringPlanSha256(value), "PLAN_SHA_READBACK_MISMATCH");
    return { status: "PASS", operation: "plan", runId, directory, target: TARGET, users: users.map((user) => ({ id: user.id, role: user.roles[0] })) };
  });
}

function loadedState(directory, target) {
  const state = load(directory, "target.json");
  equal(state.binding, TARGET, "TARGET_BINDING_MISMATCH");
  equal(state.identity, target.identity, "CONTAINER_IDENTITY_DRIFT");
  const value = load(directory, "plan.json");
  validateEngineeringPlan(value);
  stop(load(directory, "plan-sha256.json").value === engineeringPlanSha256(value), "PLAN_SHA_MISMATCH");
  return value;
}
function manifestState(directory, planValue) {
  const manifest = load(directory, "manifest.json");
  stop(manifest.runId === planValue.runId && manifest.manifestHash && manifest.baseline, "MANIFEST_MISMATCH");
  return manifest;
}
async function execute(name, statePath, partial = false) {
  const directory = stateDirectory(statePath);
  const target = inspectEngineeringLocalTarget();
  const planValue = loadedState(directory, target);
  return withEngineeringLocalDb(target, async (db) => {
    await dbGuard(db);
    if (name === "prepare") {
      stop(!existsSync(join(directory, "manifest.json")) && !existsSync(join(directory, "prepare-intent.json")), "PREPARE_ALREADY_ATTEMPTED_INSPECT_OUTCOME");
      save(directory, "prepare-intent.json", { runId: planValue.runId, planSha256: engineeringPlanSha256(planValue), at: new Date().toISOString() });
      const manifest = await prepareEngineeringOwned({ db, plan: planValue, durablePlanSha256: load(directory, "plan-sha256.json").value });
      save(directory, "manifest.json", manifest);
      equal(load(directory, "manifest.json"), manifest, "MANIFEST_READBACK_MISMATCH");
      return { status: "PASS", operation: name, runId: planValue.runId, manifestHash: manifest.manifestHash };
    }
    const manifest = manifestState(directory, planValue);
    if (name === "capture") {
      stop(!existsSync(join(directory, "captured.json")), "CAPTURE_ALREADY_EXISTS");
      const result = await captureEngineeringOwned({ db, target: TARGET, manifest, expectFinal: !partial });
      save(directory, "captured.json", result);
      equal(load(directory, "captured.json"), result, "CAPTURE_READBACK_MISMATCH");
      return { status: "PASS", operation: name, runId: planValue.runId, phase: result.phase, graphHash: result.graphHash };
    }
    stop(name === "cleanup", "OPERATION_FORBIDDEN");
    stop(!existsSync(join(directory, "cleanup-intent.json")) && !existsSync(join(directory, "cleaned.json")), "CLEANUP_ALREADY_ATTEMPTED_INSPECT_OUTCOME");
    const captured = load(directory, "captured.json");
    const drained = load(directory, "engineering-browser-drained.json");
    stop(drained.runId === planValue.runId && drained.actionsDrained === true && drained.contextsClosed === true,
      "BROWSER_ACTIONS_NOT_DRAINED");
    save(directory, "cleanup-intent.json", { runId: planValue.runId, graphHash: captured.graphHash, at: new Date().toISOString() });
    const result = await cleanupEngineeringOwned({ db, target: TARGET, manifest, captured, actionsDrained: true });
    save(directory, "cleaned.json", result);
    equal(load(directory, "cleaned.json"), result, "CLEANUP_READBACK_MISMATCH");
    return { status: "PASS", operation: name, runId: planValue.runId, deleted: result.deleted };
  });
}

export async function createEngineeringLocalSessions(statePath) {
  const directory = stateDirectory(statePath);
  const secret = process.env.QA_AUTH_SECRET;
  stop(typeof secret === "string" && secret.length >= 32, "RUNTIME_AUTH_SECRET_REQUIRED");
  const target = inspectEngineeringLocalTarget();
  const planValue = loadedState(directory, target);
  manifestState(directory, planValue);
  return withEngineeringLocalDb(target, async (db) => {
    await dbGuard(db);
    const users = await db.user.findMany({ where: { id: { in: [planValue.managerId, ...planValue.users.map((user) => user.id)] }, active: true },
      select: { id: true, roles: true, sessionVersion: true } });
    stop(users.length === 4, "SESSION_USERS_MISSING");
    const orderedUsers = orderEngineeringSessionUsers(users, planValue);
    const labels = new Map([[planValue.managerId, "manager"], [planValue.users[0].id, "e1"],
      [planValue.users[1].id, "e2"], [planValue.users[2].id, "worker"]]);
    stop(orderedUsers.every((user) => labels.has(user.id) &&
      (user.id === planValue.managerId ? user.roles.includes("MANAGER") :
        JSON.stringify(user.roles) === JSON.stringify(planValue.users.find((qa) => qa.id === user.id)?.roles))), "SESSION_ROLE_DRIFT");
    const { encode } = await import("@auth/core/jwt");
    const cookieName = "authjs.session-token";
    const sessions = await Promise.all(orderedUsers.map(async (user) => ({ role: labels.get(user.id), userId: user.id,
      cookie: { name: cookieName, value: await encode({ token: { id: user.id, roles: user.roles, sessionVersion: user.sessionVersion },
        secret, salt: cookieName, maxAge: 900 }), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" } })));
    return { status: "PASS", operation: "sessions", runId: planValue.runId, origin: "http://127.0.0.1:3106",
      count: sessions.length, ttlSeconds: 900, plan: engineeringPublicPlan(planValue), sessions };
  });
}

export function orderEngineeringSessionUsers(users, planValue) {
  const orderedIds = [planValue.managerId, ...planValue.users.map((user) => user.id)];
  const byId = new Map(users.map((user) => [user.id, user]));
  stop(users.length === 4 && byId.size === 4 && orderedIds.every((id) => byId.has(id)), "SESSION_USERS_MISSING");
  return orderedIds.map((id) => byId.get(id));
}

export function publicEngineeringSessionSummary(result) {
  return { status: result.status, operation: result.operation, runId: result.runId, origin: result.origin,
    count: result.count, ttlSeconds: result.ttlSeconds, tokens: "MEMORY_ONLY" };
}

async function main() {
  const { operation, first, second } = parseEngineeringLocalArgs(process.argv.slice(2));
  if (operation === "dry") { stop(first === undefined && second === undefined, "USAGE_INVALID"); return dry(); }
  if (operation === "plan") return plan(first, second);
  if (operation === "sessions") {
    const result = await createEngineeringLocalSessions(first);
    return publicEngineeringSessionSummary(result);
  }
  return execute(operation, first, second === "--partial");
}

export function parseEngineeringLocalArgs(args) {
  const [operation, first, second, ...extra] = args;
  stop(extra.length === 0 && ["dry", "plan", "prepare", "capture", "cleanup", "sessions"].includes(operation), "USAGE_INVALID");
  const correct = operation === "dry" ? first === undefined && second === undefined
    : operation === "plan" ? typeof first === "string" && first.length > 0 && typeof second === "string" && second.length > 0
      : operation === "capture" ? typeof first === "string" && first.length > 0 && (second === undefined || second === "--partial")
        : typeof first === "string" && first.length > 0 && second === undefined;
  stop(correct, "USAGE_INVALID");
  return { operation, first, second };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SELF).toLowerCase()) {
  void main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    const message = error instanceof Error ? error.message : "";
    const code = /^[A-Z][A-Z0-9_]{3,80}$/.test(message) ? message : "NATIVE_FAILURE_INSPECT";
    console.error(JSON.stringify({ status: "STOP", code }));
    process.exitCode = 1;
  });
}
