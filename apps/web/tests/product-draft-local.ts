import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  assert.ok(mode === "rollback-native" || mode === "concurrency-native", "LOCAL111_MODE_REQUIRED");
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
    const labels = await enumLabels(db);
    assert.ok(labels.includes("DRAFT") && labels.includes("PREPARATION"), "LOCAL111_COMMITTED_ENUM_PREREQUISITE_REQUIRED");
  } finally { await db.end(); }
  phase = mode === "rollback-native" ? "rollback-native" : "concurrency-native";
  // Только память текущего процесса; не пишем env-файлы, не меняем auth/роли/токены.
  process.env.DATABASE_URL = databaseUrl;
  process.env.CRM_MODERNIZATION_TARGET = "local";
  if (mode === "rollback-native") {
    const runner = await import("./product-draft-native");
    await runner.runProductDraftNative();
  } else {
    const runner = await import("./product-draft-concurrency-native");
    await runner.runProductDraftConcurrencyNative();
  }
}

async function enumLabels(db: Client): Promise<string[]> {
  const { rows } = await db.query<{ value: string }>("SELECT e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='ProductStatus' ORDER BY e.enumsortorder");
  return rows.map(row => row.value);
}
main().catch(error => {
  console.log(JSON.stringify({ kind: "product-draft-local", status: "FAIL", target: "local", phase }));
  reportDraftNativeError(error); process.exitCode = 1;
});
