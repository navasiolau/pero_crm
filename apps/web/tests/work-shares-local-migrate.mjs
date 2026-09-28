/**
 * LOCAL ONLY. Root runs this file only after review, from apps/web:
 *   node tests/work-shares-local-migrate.mjs prepare
 *   node tests/work-shares-local-migrate.mjs apply <absolute-receipt.json>
 * prepare does no DDL: a read-only exported snapshot backs both the custom dump
 * and database-side counts/hashes. pg_restore --list is structural proof only.
 * apply is a single-use receipt: only the installed Prisma migrate deploy is
 * invoked. No seed/reset/db push/resolve, restore-test, restore or data cleanup.
 * Credentials stay in memory/environment; raw subprocess output is private.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

export const APPROVED = Object.freeze({
  context: "desktop-linux",
  containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  containerName: "/pero_crm_pg",
  volume: "pero_crm_v2_pgdata",
  host: "127.0.0.1", port: 5433, database: "pero_crm", user: "pero",
  migration: "20260928140000_universal_work_shares",
  sqlSha256: "65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6",
  group: "TaskAllocationGroup",
  taskFields: Object.freeze(["allocationGroupId", "shareUnits", "shareAmount", "splitRevision"]),
  root: "D:\\Projects\\pero_crm_worktrees\\universal-work-shares",
  prismaVersion: "6.19.3",
});

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "../../..");
const WEB = join(ROOT, "apps", "web");
const SCHEMA = join(WEB, "prisma", "schema.prisma");
const MIGRATIONS = join(WEB, "prisma", "migrations");
const TEMP_PREFIX = "pero-work-shares-local-";
const require = createRequire(import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const pathKey = (value) => resolve(value).toLowerCase();
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en"))) : item);

class GuardError extends Error { constructor(code) { super(code); this.code = code; } }
function guard(value, code) { if (!value) throw new GuardError(code); }
function same(left, right, code) { guard(stable(left) === stable(right), code); }
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function fileHash(file) { return hash(readFileSync(file)); }
function plainFile(file) { guard(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "SOURCE_FILE_NOT_REGULAR"); }

export function assertApprovedSql(buffer) {
  const digest = hash(buffer);
  guard(digest === APPROVED.sqlSha256, "SQL_CHECKSUM_MISMATCH");
  const statements = buffer.toString("utf8").replace(/--[^\r\n]*/g, "").trim();
  guard(/^BEGIN\s*;/i.test(statements) && /COMMIT\s*;$/i.test(statements), "SQL_TRANSACTION_REQUIRED");
  return digest;
}
export function assertDatasourceSchema(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
  const blocks = [...source.matchAll(/\bdatasource\s+(\w+)\s*\{([^}]*)\}/g)];
  guard(blocks.length === 1 && blocks[0][1] === "db", "DATASOURCE_SINGLE_DB_REQUIRED");
  const fields = blocks[0][2].trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  guard(fields.length === 2 && fields.includes('provider = "postgresql"') && fields.some((line) => /^url\s*=\s*env\("DATABASE_URL"\)$/.test(line)), "DATASOURCE_LOCAL_ENV_ONLY");
  guard(!/\b(?:directUrl|shadowDatabaseUrl)\b/.test(source), "DATASOURCE_ALTERNATE_URL_FORBIDDEN");
  return true;
}
export function assertContainerIdentity(container) {
  guard(container?.Id === APPROVED.containerId && container.Name === APPROVED.containerName, "CONTAINER_IDENTITY_MISMATCH");
  guard(container.State?.Running === true && container.State.Paused === false && typeof container.State.StartedAt === "string" && Number.isFinite(Date.parse(container.State.StartedAt)), "CONTAINER_NOT_RUNNING");
  const bindings = [{ HostIp: "127.0.0.1", HostPort: "5433" }];
  same(container.HostConfig?.PortBindings?.["5432/tcp"], bindings, "CONTAINER_CONFIG_PORT_MISMATCH");
  same(container.NetworkSettings?.Ports?.["5432/tcp"], bindings, "CONTAINER_LIVE_PORT_MISMATCH");
  const mounts = container.Mounts?.filter((mount) => mount.Destination === "/var/lib/postgresql/data");
  guard(mounts?.length === 1 && mounts[0].Type === "volume" && mounts[0].Name === APPROVED.volume && mounts[0].RW === true && typeof mounts[0].Source === "string", "CONTAINER_VOLUME_MISMATCH");
  const env = Object.fromEntries(container.Config.Env.map((entry) => { const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)]; }));
  guard(env.POSTGRES_DB === APPROVED.database && env.POSTGRES_USER === APPROVED.user && typeof env.POSTGRES_PASSWORD === "string" && env.POSTGRES_PASSWORD.length > 0, "CONTAINER_DATABASE_MISMATCH");
  guard(env.PGDATA === "/var/lib/postgresql/data" || env.PGDATA === "/var/lib/postgresql/data/pgdata", "CONTAINER_PGDATA_MISMATCH");
  guard(!Object.keys(env).some((key) => ["PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS"].includes(key)), "CONTAINER_PG_CONFIG_FORBIDDEN");
  return { id: container.Id, name: container.Name, image: container.Image, startedAt: container.State.StartedAt, restartCount: container.RestartCount, volume: { name: mounts[0].Name, source: mounts[0].Source, destination: mounts[0].Destination }, pgdata: env.PGDATA, database: env.POSTGRES_DB, user: env.POSTGRES_USER, host: APPROVED.host, port: APPROVED.port };
}
export function assertLocalUrl(value, password) {
  let url;
  try { url = new URL(value); } catch { throw new GuardError("LOCAL_DATABASE_URL_INVALID"); }
  guard(url.protocol === "postgresql:" && url.hostname === APPROVED.host && url.port === String(APPROVED.port) && url.pathname === `/${APPROVED.database}` && decodeURIComponent(url.username) === APPROVED.user && decodeURIComponent(url.password) === password && !url.search && !url.hash, "LOCAL_DATABASE_URL_MISMATCH");
  return true;
}
export function assertPendingMigration(manifest, rows) {
  guard(Array.isArray(rows) && rows.every((row) => row.finishedAt || row.rolledBackAt), "MIGRATION_UNFINISHED_OR_FAILED");
  const names = new Set(manifest.map((entry) => entry.name));
  guard(rows.every((row) => names.has(row.name)), "MIGRATION_HISTORY_NOT_IN_SOURCE");
  const applied = new Set(rows.filter((row) => row.finishedAt && !row.rolledBackAt).map((row) => row.name));
  const pending = manifest.filter((entry) => !applied.has(entry.name));
  guard(pending.length === 1 && pending[0].name === APPROVED.migration && pending[0].sha256 === APPROVED.sqlSha256, "MIGRATION_PENDING_NOT_EXACT_APPROVED");
  return APPROVED.migration;
}
export function assertOriginalData(before, after, withGroup = false) {
  const remaining = { ...after };
  if (withGroup) {
    guard(remaining[APPROVED.group]?.count === "0", "DATA_NEW_GROUP_NOT_EMPTY");
    delete remaining[APPROVED.group];
  }
  same(before, remaining, "DATA_COUNTS_OR_HASHES_CHANGED");
  return true;
}
export function assertAddedDefaults(counts) {
  guard(counts?.groupCount === "0" && counts.invalidTasks === "0", "POST_ALLOCATION_DEFAULTS_CHANGED");
  return true;
}

function baseEnv(extra = {}) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath", "appdata", "localappdata", "temp", "tmp", "processor_architecture", "number_of_processors"]);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), NO_COLOR: "1", CI: "true", TZ: "UTC", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", ...extra };
}
function readCommand(executable, args) {
  try { return execFileSync(executable, args, { cwd: WEB, env: baseEnv(), encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw new GuardError("READ_COMMAND_FAILED"); }
}
function sourceGuards() {
  guard(process.platform === "win32", "WINDOWS_LOCAL_WORKTREE_REQUIRED");
  guard(pathKey(realpathSync(ROOT)) === pathKey(APPROVED.root) && pathKey(realpathSync(process.cwd())) === pathKey(WEB), "CWD_ROOT_MISMATCH");
  guard(pathKey(readCommand("git", ["--no-optional-locks", "rev-parse", "--show-toplevel"])) === pathKey(ROOT), "GIT_ROOT_MISMATCH");
  guard(readJson(join(ROOT, "package.json")).name === "pero-crm-v2" && readJson(join(WEB, "package.json")).name === "@pero/web", "PACKAGE_ROOT_MISMATCH");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "NODE_DEBUG", "NODE_DEBUG_NATIVE", "DEBUG", "DOTENV_CONFIG_PATH", "DIRECT_URL", "SHADOW_DATABASE_URL", "PRISMA_CONFIG", "PRISMA_SCHEMA", "PRISMA_SCHEMA_ENGINE_BINARY", "DOCKER_HOST", "DOCKER_CONFIG", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSWORD"]) guard(!process.env[key], "ENVIRONMENT_OVERRIDE_FORBIDDEN");
  guard(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === APPROVED.context, "DOCKER_CONTEXT_OVERRIDE_FORBIDDEN");
  for (const dir of [ROOT, WEB, dirname(SCHEMA)]) {
    for (const entry of readdirSync(dir)) {
      // .env.example is documentation, not a dotenv input; it is never loaded.
      guard(!(entry === ".env" || (entry.startsWith(".env.") && entry !== ".env.example")), "ENV_FILE_FORBIDDEN");
      guard(!/^prisma\.config\./.test(entry), "PRISMA_CONFIG_FILE_FORBIDDEN");
    }
    for (const extension of ["ts", "js", "mjs", "cjs", "mts", "cts"]) guard(!existsSync(join(dir, ".config", `prisma.${extension}`)), "PRISMA_CONFIG_FILE_FORBIDDEN");
  }
  plainFile(SCHEMA);
  assertDatasourceSchema(readFileSync(SCHEMA, "utf8"));
  const migrations = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => {
    guard(entry.isDirectory() && !entry.isSymbolicLink() && /^\d{14}_[a-z0-9_]+$/.test(entry.name), "MIGRATION_DIRECTORY_INVALID");
    const file = join(MIGRATIONS, entry.name, "migration.sql");
    plainFile(file);
    return { name: entry.name, sha256: fileHash(file) };
  }).sort((left, right) => left.name.localeCompare(right.name, "en"));
  const sqlSha256 = assertApprovedSql(readFileSync(join(MIGRATIONS, APPROVED.migration, "migration.sql")));
  const lockFile = join(MIGRATIONS, "migration_lock.toml");
  guard(/^provider\s*=\s*"postgresql"\s*$/m.test(readFileSync(lockFile, "utf8")), "MIGRATION_PROVIDER_MISMATCH");
  const prismaPackage = require.resolve("prisma/package.json");
  const cli = require.resolve("prisma/build/index.js");
  guard(readJson(prismaPackage).version === APPROVED.prismaVersion, "PRISMA_VERSION_MISMATCH");
  return { root: ROOT, cwd: WEB, helperSha256: fileHash(SELF), schemaSha256: fileHash(SCHEMA), sqlSha256, migrationLockSha256: fileHash(lockFile), migrations, prisma: { version: APPROVED.prismaVersion, cli, cliSha256: fileHash(cli) } };
}
function localTarget() {
  guard(readCommand("docker", ["context", "show"]) === APPROVED.context, "DOCKER_CONTEXT_MISMATCH");
  const [context] = JSON.parse(readCommand("docker", ["context", "inspect", APPROVED.context]));
  guard(context.Name === APPROVED.context && context.Endpoints?.docker?.Host === "npipe:////./pipe/dockerDesktopLinuxEngine", "DOCKER_ENDPOINT_NOT_LOCAL_DESKTOP");
  // Raw inspect is memory-only: never log Config.Env.
  const [container] = JSON.parse(readCommand("docker", ["--context", APPROVED.context, "inspect", APPROVED.containerId]));
  const identity = assertContainerIdentity(container);
  const password = container.Config.Env.find((entry) => entry.startsWith("POSTGRES_PASSWORD=")).slice("POSTGRES_PASSWORD=".length);
  const url = new URL(`postgresql://${APPROVED.host}:${APPROVED.port}/${APPROVED.database}`);
  url.username = APPROVED.user;
  url.password = password;
  if (process.env.DATABASE_URL) assertLocalUrl(process.env.DATABASE_URL, password);
  process.env.DATABASE_URL = url.href;
  assertLocalUrl(process.env.DATABASE_URL, password);
  return { identity, password, url: url.href };
}

function writeExclusive(file, bytes) {
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function writeOutcome(dir, name, data) {
  const destination = join(dir, name);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeExclusive(temporary, JSON.stringify(data, null, 2) + "\n");
  renameSync(temporary, destination);
}
function privateDirectory() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  guard(!lstatSync(dir).isSymbolicLink() && pathKey(dirname(realpathSync(dir))) === pathKey(realpathSync(tmpdir())), "PRIVATE_TEMP_PARENT_MISMATCH");
  const sid = readCommand("whoami", ["/user", "/fo", "csv", "/nh"]).match(/S-1-\d+(?:-\d+)+/g);
  guard(sid?.length === 1, "PRIVATE_TEMP_OWNER_UNAVAILABLE");
  // ACL change is confined to this newly created directory, never an ancestor.
  readCommand("icacls", [dir, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  return dir;
}
function receiptDirectory(input) {
  guard(typeof input === "string" && isAbsolute(input) && basename(input) === "receipt.json", "RECEIPT_PATH_REQUIRED");
  const file = resolve(input);
  const dir = dirname(file);
  guard(basename(dir).startsWith(TEMP_PREFIX) && !lstatSync(dir).isSymbolicLink() && pathKey(realpathSync(dir)) === pathKey(dir) && pathKey(dirname(dir)) === pathKey(realpathSync(tmpdir())), "RECEIPT_PRIVATE_DIRECTORY_MISMATCH");
  plainFile(file);
  const bytes = readFileSync(file);
  guard(hash(bytes) === readFileSync(join(dir, "receipt.sha256"), "utf8").trim(), "RECEIPT_CHECKSUM_MISMATCH");
  const receipt = JSON.parse(bytes.toString("utf8"));
  guard(receipt.version === 1 && receipt.kind === "PERO_WORK_SHARES_LOCAL_MIGRATION" && receipt.migration === APPROVED.migration, "RECEIPT_KIND_MISMATCH");
  guard(receipt.backup?.path === join(dir, "database.dump") && receipt.backup?.tocPath === join(dir, "backup-toc.txt"), "RECEIPT_BACKUP_PATH_MISMATCH");
  return { dir, file, receipt, sha256: hash(bytes) };
}
async function streamHash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function processToFiles(executable, args, env, stdoutPath, stderrPath, inputPath, timeout = 180_000) {
  const stdout = openSync(stdoutPath, "wx", 0o600);
  let stderr;
  let input;
  try {
    stderr = openSync(stderrPath, "wx", 0o600);
    if (inputPath) input = openSync(inputPath, "r");
    const child = spawn(executable, args, { cwd: WEB, env, windowsHide: true, shell: false, stdio: [input ?? "ignore", stdout, stderr] });
    const result = await new Promise((resolveResult) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        if (child.pid && child.exitCode === null) {
          try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
          catch { /* Outcome remains unknown; no database recovery or retry. */ }
        }
      }, timeout);
      child.once("error", () => { clearTimeout(timer); resolveResult({ exitCode: null, expired, spawnFailed: true }); });
      child.once("close", (exitCode) => { clearTimeout(timer); resolveResult({ exitCode, expired, spawnFailed: false }); });
    });
    fsyncSync(stdout);
    fsyncSync(stderr);
    return result;
  } finally {
    closeSync(stdout);
    if (stderr !== undefined) closeSync(stderr);
    if (input !== undefined) closeSync(input);
  }
}
async function readonlyClient(target) {
  // Explicit fields do not consume PGHOST/PGSERVICE or another connection URL.
  const client = new Client({ host: APPROVED.host, port: APPROVED.port, user: APPROVED.user, password: target.password, database: APPROVED.database, ssl: false, connectionTimeoutMillis: 10_000, query_timeout: 120_000, options: "-c default_transaction_read_only=on -c search_path=pg_catalog -c timezone=UTC", application_name: "work-shares-local-migration-guard" });
  client.on("error", () => {}); // Subsequent guarded queries fail; never print native credentials.
  await client.connect();
  return client;
}
async function readonly(client, fn) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
export function rowHashSql(table) {
  const row = table === "Task" ? `(pg_catalog.to_jsonb(t) - ARRAY['allocationGroupId','shareUnits','shareAmount','splitRevision'])` : "pg_catalog.to_jsonb(t)";
  return `SELECT count(*)::text AS count, pg_catalog.md5(COALESCE(pg_catalog.string_agg(r.digest, '' ORDER BY r.digest COLLATE "C"), '')) AS hash FROM (SELECT pg_catalog.md5((${row})::text) AS digest FROM public.${identifier(table)} t) r`;
}
async function stateSnapshot(client, target) {
  const { rows: [identity] } = await client.query("SELECT current_database() AS database, current_user AS username, session_user AS session_user, current_setting('transaction_read_only') AS readonly, current_setting('data_directory') AS data_directory, current_setting('server_version_num') AS version, pg_postmaster_start_time()::text AS postmaster_started, inet_server_port() AS port, pg_is_in_recovery() AS recovery");
  guard(identity.database === APPROVED.database && identity.username === APPROVED.user && identity.session_user === APPROVED.user && identity.readonly === "on" && identity.data_directory === target.identity.pgdata && identity.port === 5432 && identity.recovery === false, "DATABASE_READONLY_IDENTITY_MISMATCH");
  const { rows: [ledgerTable] } = await client.query("SELECT pg_catalog.to_regclass('public.\"_prisma_migrations\"')::text AS name");
  guard(ledgerTable.name !== null, "MIGRATION_LEDGER_REQUIRED");
  const { rows: migrations } = await client.query('SELECT id, migration_name AS name, checksum, started_at::text AS "startedAt", finished_at::text AS "finishedAt", rolled_back_at::text AS "rolledBackAt", applied_steps_count AS "steps" FROM public."_prisma_migrations" ORDER BY migration_name COLLATE "C", started_at, id');
  const { rows: catalog } = await client.query("SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations' ORDER BY c.relname COLLATE \"C\"");
  const tables = {};
  for (const { name } of catalog) {
    guard(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name), "PUBLIC_TABLE_IDENTIFIER_UNSUPPORTED");
    const { rows: [digest] } = await client.query(rowHashSql(name));
    tables[name] = digest;
  }
  guard(tables.Task && tables.Work, "REQUIRED_BUSINESS_TABLES_MISSING");
  const { rows: taskColumns } = await client.query("SELECT a.attname AS name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.\"Task\"'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum");
  return { identity, tables, taskColumns, migrations };
}
function beforeDdl(state, source) {
  assertPendingMigration(source.migrations, state.migrations);
  guard(!state.tables[APPROVED.group] && !state.taskColumns.some((column) => APPROVED.taskFields.includes(column.name)), "PRE_MIGRATION_SCHEMA_ALREADY_PRESENT");
}
function assertAppliedTracking(before, after, source) {
  guard(after.migrations.every((row) => row.finishedAt || row.rolledBackAt), "POST_MIGRATION_UNFINISHED");
  const applied = after.migrations.filter((row) => row.name === APPROVED.migration && row.finishedAt && !row.rolledBackAt);
  guard(applied.length === 1 && applied[0].checksum === APPROVED.sqlSha256, "POST_MIGRATION_TRACKING_MISMATCH");
  same(before.migrations.filter((row) => row.name !== APPROVED.migration), after.migrations.filter((row) => row.name !== APPROVED.migration), "POST_OTHER_MIGRATION_HISTORY_CHANGED");
  const appliedNames = new Set(after.migrations.filter((row) => row.finishedAt && !row.rolledBackAt).map((row) => row.name));
  guard(source.migrations.every((row) => appliedNames.has(row.name)), "POST_MIGRATION_STILL_PENDING");
}
async function addedDefaults(client, before, after) {
  const existing = after.taskColumns.filter((column) => !APPROVED.taskFields.includes(column.name));
  same(before.taskColumns, existing, "POST_ORIGINAL_TASK_COLUMNS_CHANGED");
  const added = after.taskColumns.filter((column) => APPROVED.taskFields.includes(column.name));
  same(added, [
    { name: "allocationGroupId", type: "text", required: false, default: null },
    { name: "shareUnits", type: "integer", required: false, default: null },
    { name: "shareAmount", type: "numeric(12,2)", required: false, default: null },
    { name: "splitRevision", type: "integer", required: true, default: "0" },
  ], "POST_TASK_FIELDS_MISMATCH");
  const { rows: [defaults] } = await client.query('SELECT (SELECT count(*)::text FROM public."TaskAllocationGroup") AS "groupCount", count(*) FILTER (WHERE "allocationGroupId" IS NOT NULL OR "shareUnits" IS NOT NULL OR "shareAmount" IS NOT NULL OR "splitRevision" IS NULL OR "splitRevision" <> 0)::text AS "invalidTasks" FROM public."Task"');
  assertAddedDefaults(defaults);
  return defaults;
}
async function verifyBackup(dir, expected) {
  const file = join(dir, "database.dump");
  plainFile(file);
  const fd = openSync(file, "r");
  const magic = Buffer.alloc(5);
  try {
    const { readSync } = await import("node:fs");
    readSync(fd, magic, 0, magic.length, 0);
  } finally { closeSync(fd); }
  guard(magic.toString("ascii") === "PGDMP" && statSync(file).size >= 1024, "BACKUP_CUSTOM_ARCHIVE_REQUIRED");
  const result = { path: file, bytes: statSync(file).size, sha256: await streamHash(file) };
  if (expected) {
    guard(result.bytes === expected.bytes && result.sha256 === expected.sha256, "BACKUP_BYTES_OR_CHECKSUM_CHANGED");
    plainFile(expected.tocPath);
    guard(fileHash(expected.tocPath) === expected.tocSha256, "BACKUP_TOC_CHANGED");
  }
  return result;
}
const publicCounts = (state) => ({ tables: Object.keys(state.tables).length, ...Object.fromEntries(Object.entries(state.tables).map(([name, value]) => [name, value.count])) });

async function prepare(control) {
  const source = sourceGuards();
  const target = localTarget();
  control.dir = privateDirectory();
  control.phase = "BACKUP_AND_READONLY_SNAPSHOT";
  writeOutcome(control.dir, "prepare-outcome.json", { status: "STARTED", phase: control.phase, startedAt: new Date().toISOString() });
  control.outcomeOwned = true;
  const client = await readonlyClient(target);
  try {
    const prepared = await readonly(client, async () => {
      const state = await stateSnapshot(client, target);
      beforeDdl(state, source);
      const { rows: [exported] } = await client.query("SELECT pg_catalog.pg_export_snapshot() AS snapshot");
      guard(/^[0-9a-f-]{1,100}$/i.test(exported.snapshot), "EXPORTED_SNAPSHOT_INVALID");
      const backupPath = join(control.dir, "database.dump");
      const dump = await processToFiles("docker", ["--context", APPROVED.context, "exec", "--env", "PGPASSWORD", APPROVED.containerId, "pg_dump", "--host=127.0.0.1", "--port=5432", "--username=pero", "--dbname=pero_crm", "--format=custom", `--snapshot=${exported.snapshot}`], baseEnv({ PGPASSWORD: target.password }), backupPath, join(control.dir, "pg-dump.stderr.log"));
      guard(dump.exitCode === 0 && !dump.expired && !dump.spawnFailed, "PG_DUMP_FAILED");
      const tocPath = join(control.dir, "backup-toc.txt");
      const list = await processToFiles("docker", ["--context", APPROVED.context, "exec", "-i", APPROVED.containerId, "pg_restore", "--list"], baseEnv(), tocPath, join(control.dir, "pg-restore-list.stderr.log"), backupPath, 60_000);
      guard(list.exitCode === 0 && !list.expired && !list.spawnFailed, "PG_RESTORE_LIST_FAILED");
      const toc = readFileSync(tocPath, "utf8");
      for (const table of [...Object.keys(state.tables), "_prisma_migrations"]) guard(new RegExp(`\\bTABLE public ${table}\\s`).test(toc) && new RegExp(`\\bTABLE DATA public ${table}\\s`).test(toc), "BACKUP_TOC_TABLE_MISSING");
      const backup = { ...await verifyBackup(control.dir), tocPath, tocSha256: fileHash(tocPath), structureCheckedBy: "pg_restore --list (not a restore test)", exportedSnapshot: exported.snapshot };
      return { state, backup };
    });
    same(source, sourceGuards(), "SOURCE_CHANGED_DURING_PREPARE");
    same(target.identity, localTarget().identity, "CONTAINER_CHANGED_DURING_PREPARE");
    const receipt = { version: 1, kind: "PERO_WORK_SHARES_LOCAL_MIGRATION", migration: APPROVED.migration, preparedAt: new Date().toISOString(), source, target: target.identity, before: prepared.state, backup: prepared.backup };
    const file = join(control.dir, "receipt.json");
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
    writeExclusive(file, bytes);
    writeExclusive(join(control.dir, "receipt.sha256"), hash(bytes) + "\n");
    writeOutcome(control.dir, "prepare-outcome.json", { status: "PREPARED", receipt: file, counts: publicCounts(prepared.state), backupBytes: prepared.backup.bytes, finishedAt: new Date().toISOString() });
    return { status: "PREPARED", path: file, counts: publicCounts(prepared.state) };
  } finally { await client.end().catch(() => {}); }
}
async function apply(input, control) {
  const source = sourceGuards();
  const stored = receiptDirectory(input);
  const { dir, receipt } = stored;
  control.dir = dir;
  control.phase = "APPLY_GUARDS";
  guard(!existsSync(join(dir, "apply-outcome.json")), "RECEIPT_ALREADY_ATTEMPTED");
  writeExclusive(join(dir, "apply-outcome.json"), JSON.stringify({ status: "STARTED", phase: control.phase, receiptSha256: stored.sha256, startedAt: new Date().toISOString() }) + "\n");
  control.outcomeOwned = true;
  same(source, receipt.source, "SOURCE_MANIFEST_CHANGED_SINCE_PREPARE");
  const target = localTarget();
  same(target.identity, receipt.target, "CONTAINER_CHANGED_SINCE_PREPARE");
  await verifyBackup(dir, receipt.backup);
  const client = await readonlyClient(target);
  try {
    const before = await readonly(client, () => stateSnapshot(client, target));
    beforeDdl(before, source);
    same(before, receipt.before, "DATABASE_CHANGED_SINCE_PREPARE");
    // Release read locks before ALTER TABLE, keep the guarded connection alive.
    same(source, sourceGuards(), "SOURCE_CHANGED_BEFORE_DEPLOY");
    same(target.identity, localTarget().identity, "CONTAINER_CHANGED_BEFORE_DEPLOY");
    assertLocalUrl(process.env.DATABASE_URL, target.password);
    control.phase = "PRISMA_MIGRATE_DEPLOY";
    writeOutcome(dir, "apply-outcome.json", { status: "DEPLOYING", phase: control.phase, receiptSha256: stored.sha256, beforeCounts: publicCounts(before), startedAt: new Date().toISOString() });
    const deploy = await processToFiles(process.execPath, [source.prisma.cli, "migrate", "deploy", "--schema", SCHEMA], baseEnv({ DATABASE_URL: target.url }), join(dir, "prisma-deploy.stdout.log"), join(dir, "prisma-deploy.stderr.log"), undefined, 300_000);
    control.deploy = deploy;
    guard(deploy.exitCode === 0 && !deploy.expired && !deploy.spawnFailed, "PRISMA_DEPLOY_FAILED_OUTCOME_REQUIRES_REVIEW");
    control.phase = "POST_DEPLOY_VERIFICATION";
    same(target.identity, localTarget().identity, "CONTAINER_CHANGED_AFTER_DEPLOY");
    same(source, sourceGuards(), "SOURCE_CHANGED_AFTER_DEPLOY");
    const verified = await readonly(client, async () => {
      const after = await stateSnapshot(client, target);
      same(before.identity, after.identity, "DATABASE_IDENTITY_CHANGED_AFTER_DEPLOY");
      assertAppliedTracking(before, after, source);
      assertOriginalData(before.tables, after.tables, true);
      const defaults = await addedDefaults(client, before, after);
      return { after, defaults };
    });
    same(target.identity, localTarget().identity, "CONTAINER_CHANGED_AFTER_VERIFICATION");
    writeOutcome(dir, "apply-outcome.json", { status: "APPLIED_AND_VERIFIED", receiptSha256: stored.sha256, deploy, source, target: target.identity, beforeCounts: publicCounts(before), after: verified.after, defaults: verified.defaults, finishedAt: new Date().toISOString() });
    return { status: "APPLIED_AND_VERIFIED", path: join(dir, "apply-outcome.json"), counts: publicCounts(verified.after) };
  } finally { await client.end().catch(() => {}); }
}

export function recordFailure(operation, control, error) {
  const code = error instanceof GuardError ? error.code : "LOCAL_MIGRATION_HELPER_FAILED";
  let path = control.dir;
  // A denied second apply must preserve the previous success/failure evidence.
  if (control.dir && control.outcomeOwned) {
    path = join(control.dir, `${operation === "apply" ? "apply" : "prepare"}-outcome.json`);
    try { writeOutcome(control.dir, basename(path), { status: "STOP", code, phase: control.phase, deploy: control.deploy, finishedAt: new Date().toISOString(), automaticRepair: false, dumpRestored: false }); }
    catch { path = control.dir; }
  }
  return { status: "STOP", code, ...(path ? { path } : {}) };
}
async function main() {
  const [operation, input, ...extra] = process.argv.slice(2);
  const control = { phase: "ARGUMENT_GUARD", dir: undefined, deploy: undefined, outcomeOwned: false };
  try {
    guard(extra.length === 0 && (operation === "prepare" ? input === undefined : operation === "apply" && typeof input === "string"), "USAGE_PREPARE_OR_APPLY_RECEIPT");
    const result = operation === "prepare" ? await prepare(control) : await apply(input, control);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify(recordFailure(operation, control, error)));
    process.exitCode = 1;
  }
}

// Importing this module for pure guard tests never invokes Docker, pg_dump or DB.
if (process.argv[1] && pathKey(process.argv[1]) === pathKey(SELF)) void main().catch(() => {
  console.error(JSON.stringify({ status: "STOP", code: "UNEXPECTED_HELPER_FAILURE" }));
  process.exitCode = 1;
});
