// Root opt-in, apps/web: node tests/engineering-local-migrate.mjs prepare
// then: node tests/engineering-local-migrate.mjs apply <absolute receipt.json>
// SAFETY-RULES.md applies. Existing local DB only; no reset, seed, restore or retry.
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { assertContainerIdentity, assertDatasourceSchema } from "./work-shares-local-migrate.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), ".."), ROOT = resolve(WEB, "../..");
const MIGRATION = "20260928220000_product_engineering_pay";
const SQL_SHA = "0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266";
const NEW_TABLES = ["ProductStagePayPool", "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare"];
const ADDED = { Work: ["paymentKind", "stagePayPoolId", "poolWeightUnits"], Task: ["stageShareUnits"], TaskAllocationGroup: ["budgetSource"], PayrollEntry: ["productId", "settlementShareId", "bynAmount", "projectAmount", "projectCurrency"] };
const require = createRequire(import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stable = (x) => JSON.stringify(x, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
const check = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b, code) => check(stable(a) === stable(b), code);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const identifier = (s) => { check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(s), "TABLE_NAME_INVALID"); return `"${s}"`; };

export function engineeringMigrationProjection(table) {
  return ADDED[table] ? `to_jsonb(t) - ARRAY[${ADDED[table].map((s) => `'${s}'`).join(",")}]` : "to_jsonb(t)";
}
export function assertEngineeringMigrationData(before, after) {
  const old = { ...after };
  for (const table of NEW_TABLES) { check(old[table]?.count === "0", "NEW_TABLE_NOT_EMPTY"); delete old[table]; }
  same(before, old, "LEGACY_DATA_CHANGED");
}
function save(file, value) {
  const data = Buffer.from(stable(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(data), "DURABLE_READBACK_FAILED");
}
function command(exe, args, options = {}) {
  return execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 20000, stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}
function source() {
  check(process.platform === "win32" && realpathSync(ROOT).toLowerCase() === "d:\\projects\\pero_crm_worktrees\\product-engineering-pay" && realpathSync(process.cwd()).toLowerCase() === WEB.toLowerCase(), "LOCAL_WORKTREE_REQUIRED");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "PRISMA_CONFIG", "PRISMA_SCHEMA_ENGINE_BINARY", "DIRECT_URL", "SHADOW_DATABASE_URL", "DOCKER_HOST", "PGOPTIONS", "PGSERVICE", "PGSERVICEFILE"]) check(!process.env[key], "ENV_OVERRIDE_FORBIDDEN");
  for (const dir of [ROOT, WEB, join(WEB, "prisma")]) {
    check(!readdirSync(dir).some((n) => n === ".env" || (n.startsWith(".env.") && n !== ".env.example") || /^prisma\.config\./.test(n)), "ALTERNATE_CONFIG_FORBIDDEN");
  }
  const schema = join(WEB, "prisma/schema.prisma"), migrations = join(WEB, "prisma/migrations");
  assertDatasourceSchema(readFileSync(schema, "utf8"));
  const manifest = readdirSync(migrations, { withFileTypes: true }).filter((x) => x.isDirectory()).map(({ name }) => ({ name, sha256: sha(readFileSync(join(migrations, name, "migration.sql"))) })).sort((a, b) => a.name.localeCompare(b.name));
  check(manifest.find((x) => x.name === MIGRATION)?.sha256 === SQL_SHA, "SQL_CHECKSUM_MISMATCH");
  check(read(require.resolve("prisma/package.json")).version === "6.19.3", "PRISMA_VERSION_MISMATCH");
  return { manifest, schema, schemaSha: sha(readFileSync(schema)), selfSha: sha(readFileSync(SELF)), cli: require.resolve("prisma/build/index.js") };
}
function target() {
  const context = JSON.parse(command("docker", ["context", "inspect", "desktop-linux"]))[0];
  check(context.Endpoints.docker.Host === "npipe:////./pipe/dockerDesktopLinuxEngine", "DOCKER_ENDPOINT_MISMATCH");
  const c = JSON.parse(command("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"]))[0];
  const identity = assertContainerIdentity(c);
  const password = c.Config.Env.find((x) => x.startsWith("POSTGRES_PASSWORD=")).slice(18);
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm"); url.username = "pero"; url.password = password;
  return { identity, password, url: url.href };
}
async function connect(t) {
  const c = new Client({ host: "127.0.0.1", port: 5433, user: "pero", password: t.password, database: "pero_crm", ssl: false, connectionTimeoutMillis: 10000, options: "-c default_transaction_read_only=on -c timezone=UTC", application_name: "engineering-local-migration" });
  c.on("error", () => {}); await c.connect(); return c;
}
async function snapshot(c, t) {
  const { rows: [id] } = await c.query("SELECT current_database() AS db,current_user AS usr,current_setting('data_directory') AS dir,current_setting('transaction_read_only') AS ro,pg_is_in_recovery() AS recovery");
  check(id.db === "pero_crm" && id.usr === "pero" && id.dir === t.identity.pgdata && id.ro === "on" && !id.recovery, "DB_IDENTITY_MISMATCH");
  const { rows: tables } = await c.query("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename");
  const hashes = {};
  for (const { name } of tables) {
    const { rows: [r] } = await c.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(d,'' ORDER BY d COLLATE "C"),'')) AS hash FROM (SELECT md5((${engineeringMigrationProjection(name)})::text) AS d FROM public.${identifier(name)} t) q`); hashes[name] = r;
  }
  const { rows: migrations } = await c.query('SELECT id,migration_name AS name,checksum,finished_at::text AS finished,rolled_back_at::text AS rolled FROM public."_prisma_migrations" ORDER BY migration_name,id');
  return { hashes, migrations };
}
function before(s, src) {
  check(NEW_TABLES.every((n) => !s.hashes[n]) && s.hashes.PayrollEntry?.count === "0", "SCHEMA_OR_LEGACY_COVERAGE_CHANGED");
  check(s.migrations.every((r) => r.finished || r.rolled), "FAILED_MIGRATION");
  const applied = new Set(s.migrations.filter((r) => r.finished && !r.rolled).map((r) => r.name));
  same(src.manifest.filter((r) => !applied.has(r.name)), [{ name: MIGRATION, sha256: SQL_SHA }], "PENDING_MIGRATION_MISMATCH");
  check([...applied].every((n) => src.manifest.some((r) => r.name === n)), "UNKNOWN_MIGRATION");
}
function privateDir() {
  const dir = mkdtempSync(join(tmpdir(), "pero-engineering-migration-"));
  const sid = command("whoami", ["/user", "/fo", "csv", "/nh"]).match(/S-1-\d+(?:-\d+)+/g);
  check(sid?.length === 1, "OWNER_SID_REQUIRED");
  command("icacls", [dir, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  return dir;
}
async function runFile(exe, args, dir, label, env, inputFile) {
  const out = openSync(join(dir, `${label}.out`), "wx", 0o600), err = openSync(join(dir, `${label}.err`), "wx", 0o600);
  const input = inputFile ? openSync(inputFile, "r") : undefined;
  try {
    const p = spawn(exe, args, { cwd: WEB, env, windowsHide: true, stdio: [input ?? "ignore", out, err] });
    await new Promise((res, rej) => { p.once("error", () => rej(new Error(`${label}_SPAWN_FAILED`))); p.once("close", (code) => code === 0 ? res() : rej(new Error(`${label}_FAILED`))); });
    fsyncSync(out); fsyncSync(err);
  } finally { closeSync(out); closeSync(err); if (input !== undefined) closeSync(input); }
}
async function main() {
  const [op, path, ...extra] = process.argv.slice(2);
  check(!extra.length && (op === "prepare" ? !path : op === "apply" && path), "USAGE_PREPARE_OR_APPLY_RECEIPT");
  const src = source(), t = target(), c = await connect(t);
  let dir;
  try {
    if (op === "prepare") {
      dir = privateDir(); await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await snapshot(c, t); before(state, src);
      const { rows: [r] } = await c.query("SELECT pg_export_snapshot() AS snapshot");
      await runFile("docker", ["--context", "desktop-linux", "exec", "-e", "PGPASSWORD", t.identity.id, "pg_dump", "-h", "127.0.0.1", "-U", "pero", "-d", "pero_crm", "-Fc", `--snapshot=${r.snapshot}`], dir, "database.dump", { ...process.env, PGPASSWORD: t.password });
      const dump = join(dir, "database.dump.out");
      check(readFileSync(dump).subarray(0, 5).toString() === "PGDMP", "INVALID_BACKUP");
      await runFile("docker", ["--context", "desktop-linux", "exec", "-i", t.identity.id, "pg_restore", "--list"], dir, "backup-toc", process.env, dump);
      // Read/decompress every archive item to a private file, without executing SQL.
      await runFile("docker", ["--context", "desktop-linux", "exec", "-i", t.identity.id, "pg_restore", "--file=-"], dir, "backup-readable", process.env, dump);
      await c.query("COMMIT");
      same(src, source(), "SOURCE_DRIFT"); same(t.identity, target().identity, "TARGET_DRIFT");
      const receipt = { migration: MIGRATION, sqlSha: SQL_SHA, source: src, target: t.identity, state, dumpSha: sha(readFileSync(dump)), preparedAt: new Date().toISOString() };
      save(join(dir, "receipt.json"), receipt); save(join(dir, "receipt.sha.json"), { sha: sha(readFileSync(join(dir, "receipt.json"))) });
      console.log(JSON.stringify({ status: "BACKUP_READY", receipt: join(dir, "receipt.json"), tables: Object.keys(state.hashes).length, backupBytes: lstatSync(dump).size, restoreTest: false }));
    } else {
      dir = dirname(resolve(path));
      check(realpathSync(dir) === dir && dirname(dir).toLowerCase() === realpathSync(tmpdir()).toLowerCase() && dir.includes("pero-engineering-migration-") && resolve(path) === join(dir, "receipt.json"), "PRIVATE_RECEIPT_REQUIRED");
      check(!existsSync(join(dir, "apply-intent.json")), "ALREADY_ATTEMPTED_INSPECT_ONLY");
      const receipt = read(path);
      check(sha(readFileSync(path)) === read(join(dir, "receipt.sha.json")).sha, "RECEIPT_DRIFT");
      same(src, receipt.source, "SOURCE_DRIFT"); same(t.identity, receipt.target, "TARGET_DRIFT");
      check(sha(readFileSync(join(dir, "database.dump.out"))) === receipt.dumpSha, "BACKUP_DRIFT");
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const state = await snapshot(c, t); before(state, src); same(state, receipt.state, "PRE_MIGRATION_DRIFT"); await c.query("COMMIT");
      const { rows: [active] } = await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle'");
      check(active.n === 0, "ACTIVE_WRITERS_STOP");
      save(join(dir, "apply-intent.json"), { sqlSha: SQL_SHA, target: t.identity, time: new Date().toISOString() });
      await runFile(process.execPath, [src.cli, "migrate", "deploy", "--schema", src.schema], dir, "prisma-deploy", { ...process.env, DATABASE_URL: t.url, NO_COLOR: "1" });
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const after = await snapshot(c, t);
      assertEngineeringMigrationData(state.hashes, after.hashes);
      same(state.migrations, after.migrations.filter((r) => r.name !== MIGRATION), "OLD_LEDGER_DRIFT");
      const applied = after.migrations.filter((r) => r.name === MIGRATION);
      check(applied.length === 1 && applied[0].finished && !applied[0].rolled && applied[0].checksum === SQL_SHA, "MIGRATION_RECEIPT_MISMATCH");
      const { rows: [defaults] } = await c.query(`SELECT (SELECT count(*) FROM "Work" WHERE "paymentKind"<>'LEGACY' OR "stagePayPoolId" IS NOT NULL OR "poolWeightUnits" IS NOT NULL)::int AS work,(SELECT count(*) FROM "Task" WHERE "stageShareUnits" IS NOT NULL)::int AS task,(SELECT count(*) FROM "TaskAllocationGroup" WHERE "budgetSource"<>'TASK_FIXED')::int AS groups`);
      check(defaults.work === 0 && defaults.task === 0 && defaults.groups === 0, "LEGACY_DEFAULTS_CHANGED"); await c.query("COMMIT");
      same(t.identity, target().identity, "TARGET_DRIFT"); save(join(dir, "applied.json"), { status: "APPLIED_AND_PRESERVED", after, defaults, time: new Date().toISOString() });
      console.log(JSON.stringify({ status: "APPLIED_AND_PRESERVED", migration: MIGRATION, existingTablesPreserved: Object.keys(state.hashes).length, newTablesEmpty: 4, evidence: join(dir, "applied.json") }));
    }
  } finally { await c.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => {
  // Whitelist code-shaped diagnostics; never echo native SQL/URLs/passwords.
  console.error(JSON.stringify({ status: "STOP", code: /^[A-Z_]+$/.test(e.message) ? e.message : "NATIVE_FAILURE_REVIEW_PRIVATE_OUTPUT" })); process.exitCode = 1;
});
