import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { reportDraftNativeError } from "./helpers/product-draft-native";

type LocalContainer = {
  Id: string; Name: string;
  State: { Running: boolean; Health?: { Status: string } };
  Mounts: { Type: string; Name?: string; Destination: string }[];
};
let phase = "guard";

/** Только разрешённый оператором local prerequisite; пароль/URL не выводятся. */
async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "enum-only" || mode === "rollback-native", "LOCAL111_MODE_REQUIRED");
  assert.equal(process.platform, "win32", "LOCAL111_WINDOWS_REQUIRED");
  assert.ok(!process.env.CRM_MODERNIZATION_TARGET || process.env.CRM_MODERNIZATION_TARGET === "local", "LOCAL111_TARGET_MISMATCH");
  assert.ok(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === "desktop-linux", "LOCAL111_DOCKER_CONTEXT_OVERRIDE");
  assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === "npipe:////./pipe/dockerDesktopLinuxEngine", "LOCAL111_DOCKER_HOST_OVERRIDE");
  const context = execFileSync("docker", ["context", "show"], { encoding: "utf8", windowsHide: true }).trim();
  assert.equal(context, "desktop-linux", "LOCAL111_DOCKER_CONTEXT_MISMATCH");
  const [configuration] = JSON.parse(execFileSync("docker", ["context", "inspect", "desktop-linux"], { encoding: "utf8", windowsHide: true }));
  assert.equal(configuration.Endpoints.docker.Host, "npipe:////./pipe/dockerDesktopLinuxEngine", "LOCAL111_DOCKER_ENDPOINT_MISMATCH");
  const databaseUrl = existingLocalCrmDatabaseUrl();
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], {
    encoding: "utf8", windowsHide: true,
  })) as LocalContainer[];
  assert.equal(container.Id, process.env.CRM_LOCAL_CONTAINER_ID, "LOCAL111_CONTAINER_MISMATCH");
  assert.equal(container.Name, "/pero_crm_pg", "LOCAL111_CONTAINER_NAME_MISMATCH");
  assert.equal(container.State.Running, true, "LOCAL111_CONTAINER_STOPPED");
  if (container.State.Health) assert.equal(container.State.Health.Status, "healthy", "LOCAL111_CONTAINER_NOT_HEALTHY");
  assert.ok(container.Mounts.some(mount => mount.Type === "volume" && mount.Name === "pero_crm_v2_pgdata" &&
    mount.Destination === "/var/lib/postgresql/data"), "LOCAL111_VOLUME_MISMATCH");
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "5433");
  assert.equal(url.pathname, "/pero_crm"); assert.equal(url.username, "pero");
  if (process.env.DATABASE_URL) {
    const inherited = new URL(process.env.DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(inherited.hostname), "LOCAL111_INHERITED_URL_HOST_MISMATCH");
    assert.equal(inherited.port, "5433"); assert.equal(inherited.pathname, "/pero_crm");
    assert.equal(inherited.username, "pero");
  }
  const db = new Client({ connectionString: databaseUrl, ssl: false, connectionTimeoutMillis: 10_000,
    application_name: "crm-task111-local-prerequisite", options: "-c timezone=UTC -c lock_timeout=5000 -c statement_timeout=120000" });
  db.on("error", () => {});
  phase = "identity";
  await db.connect();
  try {
    const { rows: [identity] } = await db.query("SELECT current_database() AS db,current_schema() AS schema,current_user AS role,current_setting('data_directory') AS directory,pg_is_in_recovery() AS recovery");
    assert.equal(identity.db, "pero_crm"); assert.equal(identity.schema, "public"); assert.equal(identity.role, "pero");
    assert.equal(identity.directory, "/var/lib/postgresql/data"); assert.equal(identity.recovery, false);
    if (mode === "enum-only") {
      const sql = readFileSync(new URL("../prisma/migrations/20261008111000_product_draft_enum/migration.sql", import.meta.url), "utf8");
      const statement = sql.replace(/--[^\n]*/g, "").trim();
      assert.equal(statement, 'ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS \'DRAFT\' BEFORE \'PREPARATION\';', "LOCAL111_ENUM_SQL_CHANGED");
      phase = "before";
      const before = await inventory(db);
      const labelsBefore = await enumLabels(db);
      assert.ok(labelsBefore.includes("PREPARATION"), "LOCAL111_PREPARATION_ENUM_REQUIRED");
      phase = "enum";
      // ОДИН standalone statement, вне BEGIN: новое enum значение фиксируется до rollback-harness.
      await db.query(statement);
      phase = "after";
      const after = await inventory(db), labels = await enumLabels(db);
      assert.deepEqual(after, before, "LOCAL111_ENUM_CHANGED_ROWS_DEFAULT_OR_MIGRATION_LEDGER");
      assert.deepEqual(labels.filter(label => label !== "DRAFT"), labelsBefore.filter(label => label !== "DRAFT"));
      assert.equal(labels.indexOf("DRAFT") + 1, labels.indexOf("PREPARATION"), "LOCAL111_ENUM_ORDER_MISMATCH");
      console.log(JSON.stringify({ kind: "product-draft-local-enum", status: "PASS", target: "local",
        containerId: container.Id, enumCommitted: true, backfillExecuted: false, rowsDefaultLedgerUnchanged: true,
        sqlSha256: createHash("sha256").update(sql).digest("hex"), tables: Object.keys(before.tables).length }));
      return;
    }
    const labels = await enumLabels(db);
    assert.ok(labels.includes("DRAFT") && labels.includes("PREPARATION"), "LOCAL111_COMMITTED_ENUM_PREREQUISITE_REQUIRED");
  } finally { await db.end(); }
  phase = "rollback-native";
  // Только память текущего процесса; не пишем env-файлы, не меняем auth/роли/токены.
  process.env.DATABASE_URL = databaseUrl;
  process.env.CRM_MODERNIZATION_TARGET = "local";
  const runner = await import("./product-draft-native");
  await runner.runProductDraftNative();
}

async function enumLabels(db: Client): Promise<string[]> {
  const { rows } = await db.query<{ value: string }>("SELECT e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='ProductStatus' ORDER BY e.enumsortorder");
  return rows.map(row => row.value);
}
async function inventory(db: Client) {
  await db.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
  try {
    const { rows: names } = await db.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const tables: Record<string, { count: string; hash: string }> = {};
    for (const { name } of names) {
      assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
      const { rows: [hash] } = await db.query<{ count: string; hash: string }>('SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,\'\' ORDER BY row_to_json(t)::text),\'\')) AS hash FROM "' + name + '" t');
      tables[name] = hash;
    }
    const { rows: [status] } = await db.query<{ value: string }>("SELECT column_default AS value FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='status'");
    await db.query("COMMIT");
    return { tables, default: status.value };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}
main().catch(error => {
  console.log(JSON.stringify({ kind: "product-draft-local", status: "FAIL", target: "local", phase }));
  reportDraftNativeError(error); process.exitCode = 1;
});