/** Явный локальный runner: существующая CRM, никаких seed/reset/restore. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";

const migration = "20261001120000_product_quantity";
const root = resolve(import.meta.dirname, "../../..");
const output = join(root, ".playwright-mcp/product-quantity");
const statePath = join(output, "migration.json");
const expectedContainerId = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
type Fingerprints = Record<string, { count: string; hash: string }>;

async function fingerprint(db: PrismaClient): Promise<Fingerprints> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  const result: Fingerprints = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[A-Za-z][A-Za-z0-9_]*$/);
    const projection = tablename === "Product" ? "to_jsonb(t)-'quantity'" :
      ["Work", "ProjectMaterial"].includes(tablename) ? "to_jsonb(t)-'quantityPerUnit'" : "to_jsonb(t)";
    const [row] = await db.$queryRawUnsafe<{ count: string; hash: string }[]>(
      `SELECT count(*)::text AS count, md5(coalesce(string_agg(md5((${projection})::text), '' ORDER BY md5((${projection})::text)),'')) AS hash FROM "${tablename}" t`);
    result[tablename] = row;
  }
  return result;
}

async function main() {
  assert.equal(process.platform, "win32", "LOCAL_WINDOWS_REQUIRED");
  assert.equal(resolve(process.cwd()), join(root, "apps/web"), "LOCAL_SOURCE_REQUIRED");
  assert.ok(root.toLowerCase().endsWith("\\worktrees\\product-quantity\\pero_crm_v2"), "LOCAL_WORKTREE_REQUIRED");
  assert.ok(!process.env.DIRECT_URL && !process.env.DOCKER_HOST, "TARGET_OVERRIDE_FORBIDDEN");
  process.env.CRM_LOCAL_CONTAINER_ID = expectedContainerId;
  const url = existingLocalCrmDatabaseUrl();
  mkdirSync(output, { recursive: true });
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const [identity] = await db.$queryRaw<{ database: string; user: string }[]>`SELECT current_database() AS database, current_user AS "user"`;
    assert.deepEqual(identity, { database: "pero_crm", user: "pero" }, "LOCAL_DATABASE_IDENTITY");
    const operation = process.argv[2];
    if (operation === "prepare") {
      assert.ok(!existsSync(statePath), "PREPARATION_ALREADY_EXISTS");
      const sqlPath = join(root, "apps/web/prisma/migrations", migration, "migration.sql");
      const sqlSha = sha(readFileSync(sqlPath));
      const migrations = readdirSync(join(root, "apps/web/prisma/migrations")).filter((name) => /^20\d+_/.test(name)).sort();
      const history = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations"`;
      assert.ok(history.every((row) => row.finished_at || row.rolled_back_at), "FAILED_MIGRATION_PRESENT");
      const applied = new Set(history.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
      assert.deepEqual(migrations.filter((name) => !applied.has(name)), [migration], "PENDING_MIGRATION_NOT_EXACT");
      assert.ok([...applied].every((name) => migrations.includes(name)), "TARGET_HAS_OTHER_MIGRATIONS");
      const { before, dump } = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
        const before = await fingerprint(tx as unknown as PrismaClient);
        const [row] = await tx.$queryRaw<{ snapshot: string }[]>`SELECT pg_export_snapshot() AS snapshot`;
        assert.match(row.snapshot, /^[0-9A-Fa-f-]+$/);
        const dump = execFileSync("docker", ["exec", expectedContainerId, "pg_dump", "-U", "pero", "-Fc", "pero_crm", `--snapshot=${row.snapshot}`],
          { windowsHide: true, maxBuffer: 128 * 1024 * 1024, timeout: 60_000 });
        return { before, dump };
      }, { timeout: 90_000 });
      const dumpPath = join(output, "before-quantity.dump");
      writeFileSync(dumpPath, dump, { mode: 0o600 });
      const toc = execFileSync("docker", ["exec", "-i", expectedContainerId, "pg_restore", "--list"],
        { input: dump, windowsHide: true, timeout: 30_000 }).toString();
      assert.ok(toc.includes("Product") && toc.includes("PayrollEntry"), "BACKUP_TOC_INCOMPLETE");
      writeFileSync(statePath, JSON.stringify({ runId: randomUUID(), containerId: expectedContainerId, migration, sqlSha,
        before, backup: { path: dumpPath, bytes: dump.length, sha256: sha(dump), tocSha256: sha(toc), proof: "TOC only; not a restore test" } }, null, 2));
      console.log(JSON.stringify({ status: "MIGRATION_PREPARED", tables: Object.keys(before).length, backupBytes: dump.length, migration }));
    } else if (operation === "apply") {
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      assert.equal(state.containerId, expectedContainerId);
      assert.equal(sha(readFileSync(join(root, "apps/web/prisma/migrations", migration, "migration.sql"))), state.sqlSha, "SQL_DRIFT");
      assert.deepEqual(await fingerprint(db), state.before, "BUSINESS_BASELINE_DRIFT");
      const cli = join(root, "node_modules/.pnpm", readdirSync(join(root, "node_modules/.pnpm")).find((name) => /^prisma@6\.19\.3_/.test(name))!, "node_modules/prisma/build/index.js");
      const result = spawnSync(process.execPath, [cli, "migrate", "deploy"], { cwd: join(root, "apps/web"),
        env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      writeFileSync(join(output, "migration-cli.log"), (result.stdout ?? "") + (result.stderr ?? ""));
      assert.equal(result.status, 0, "MIGRATION_DEPLOY_FAILED");
      const after = await fingerprint(db);
      assert.deepEqual(after, state.before, "PREVIOUS_BUSINESS_VALUES_CHANGED");
      const [validation] = await db.$queryRaw<{ products: string; works: string; materials: string }[]>`
        SELECT (SELECT count(*) FROM "Product" WHERE quantity <> 1)::text AS products,
        (SELECT count(*) FROM "Work" WHERE "productId" IS NOT NULL AND "paymentKind"='LEGACY' AND "quantityPerUnit" IS DISTINCT FROM quantity)::text AS works,
        (SELECT count(*) FROM "ProjectMaterial" WHERE "quantityPerUnit" IS DISTINCT FROM quantity)::text AS materials`;
      assert.deepEqual(validation, { products: "0", works: "0", materials: "0" }, "BACKFILL_INCONSISTENT");
      writeFileSync(join(output, "migration-verified.json"), JSON.stringify({ status: "MIGRATION_VERIFIED",
        migration, sqlSha256: state.sqlSha, tables: Object.keys(after).length, validation, backup: state.backup }, null, 2));
      console.log(JSON.stringify({ status: "MIGRATION_VERIFIED", tablesPreserved: Object.keys(after).length, validation }));
    } else throw new Error("EXPLICIT_OPERATION_REQUIRED");
  } finally { await db.$disconnect(); }
}

main().catch((error) => {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "local-failure.private.log"), String(error?.stack ?? error), { mode: 0o600 });
  console.error("PRODUCT_QUANTITY_LOCAL_STOP"); process.exitCode = 1;
});
