import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Client } from "pg";
import type { Role } from "@prisma/client";

// Общий подход с management-dashboard-local.ts. Только утверждённая локальная БД.
const containerId = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
export const localBase = "http://localhost:3104";
export const localStatePath = path.resolve("../../.playwright-mcp/mobile-local-state.json");
const tables = ["User", "Client", "Project", "Product", "Task", "Work", "File", "Payment", "Payout", "PayrollEntry", "Material", "ProjectMaterial", "StockMovement"];
export type LocalProfile = { id: string; roles: Role[]; sessionVersion: number; activeTasks: number };
type Preference = { userId: string; key: string; value: string | null };
export type MobileLocalState = {
  secret: string;
  profiles: Record<string, LocalProfile | undefined>;
  projectPath: string;
  productPath: string;
  baseline: Record<string, unknown>;
  preferences: Preference[];
};

export async function localConnection() {
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], { encoding: "utf8" }));
  assert.equal(container.Id, containerId);
  assert.equal(container.Name, "/pero_crm_pg");
  assert.equal(container.State.Running, true);
  assert.ok(container.Mounts.some((mount: { Type: string; Name: string; Destination: string }) =>
    mount.Type === "volume" && mount.Name === "pero_crm_v2_pgdata" && mount.Destination === "/var/lib/postgresql/data"));
  assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "5433" }]);
  const env = Object.fromEntries(container.Config.Env.map((entry: string) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  assert.equal(env.POSTGRES_DB, "pero_crm");
  assert.equal(env.POSTGRES_USER, "pero");
  assert.ok(env.POSTGRES_PASSWORD);
  for (const file of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
    assert.equal(existsSync(path.resolve(file)), false, "refuse ambient runtime env");
    assert.equal(existsSync(path.resolve("../..", file)), false, "refuse ambient workspace env");
  }
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = env.POSTGRES_USER;
  url.password = env.POSTGRES_PASSWORD;
  const db = new Client({ connectionString: url.href, options: "-c default_transaction_read_only=on" });
  await db.connect();
  const { rows: [identity] } = await db.query("SELECT current_database() AS name, current_user AS username, current_setting('transaction_read_only') AS readonly");
  assert.deepEqual(identity, { name: "pero_crm", username: "pero", readonly: "on" });
  console.log("PASS mobile guard: exact local container/volume, loopback5433, readonly harness");
  return { db, dsn: url.href };
}

export async function snapshot(db: Client) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const { rows: [value] } = await db.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) AS hash FROM "${table}" t`);
    result[table] = value;
  }
  return result;
}

async function selectState(db: Client): Promise<MobileLocalState> {
  const { rows } = await db.query<LocalProfile>(`SELECT u.id, u.roles::text[] AS roles, u."sessionVersion",
    (SELECT count(*)::int FROM "Task" t WHERE t."assigneeId"=u.id AND t.status <> 'DONE') AS "activeTasks"
    FROM "User" u WHERE u.active=true ORDER BY "activeTasks" DESC, u.id`);
  const profiles: Record<string, LocalProfile | undefined> = {};
  for (const role of ["ADMIN", "MANAGER", "WORKER", "ENGINEER", "MOUNTER"]) {
    profiles[role.toLowerCase()] = rows.find((row) => row.roles.length === 1 && row.roles[0] === role);
  }
  profiles.combined = rows.find((row) => row.roles.length === 2 && row.roles.includes("MANAGER") && row.roles.includes("ENGINEER"));
  const { rows: [project] } = await db.query('SELECT id FROM "Project" WHERE currency=\'BYN\' ORDER BY length(title) DESC, id LIMIT 1');
  const { rows: [product] } = await db.query('SELECT id FROM "Product" ORDER BY length(title) DESC, id LIMIT 1');
  assert.ok(project && product, "existing project/product required");
  const preferences: Preference[] = [];
  for (const role of ["worker", "mounter"]) {
    const profile = profiles[role];
    if (!profile) continue;
    const { rows: [row] } = await db.query('SELECT value FROM "UserPreference" WHERE "userId"=$1 AND key=$2', [profile.id, "my.view"]);
    preferences.push({ userId: profile.id, key: "my.view", value: row?.value ?? null });
  }
  return { secret: randomBytes(48).toString("base64url"), profiles, projectPath: `/projects/${project.id}`,
    productPath: `/products/${product.id}`, baseline: await snapshot(db), preferences };
}

async function restorePreferences(db: Client, state: MobileLocalState) {
  // Исключение из read-only только для CAS-возврата двух согласованных UI-предпочтений.
  await db.query("BEGIN READ WRITE");
  try {
    for (const saved of state.preferences) {
      assert.equal(saved.key, "my.view");
      assert.ok([state.profiles.worker?.id, state.profiles.mounter?.id].includes(saved.userId));
      const { rows: [current] } = await db.query('SELECT value FROM "UserPreference" WHERE "userId"=$1 AND key=$2 FOR UPDATE', [saved.userId, saved.key]);
      if ((current?.value ?? null) === saved.value) continue;
      assert.equal(current?.value, "kanban", "preference changed outside this test; STOP");
      const result = saved.value === null
        ? await db.query('DELETE FROM "UserPreference" WHERE "userId"=$1 AND key=$2 AND value=$3', [saved.userId, saved.key, "kanban"])
        : await db.query('UPDATE "UserPreference" SET value=$4 WHERE "userId"=$1 AND key=$2 AND value=$3', [saved.userId, saved.key, "kanban", saved.value]);
      assert.equal(result.rowCount, 1);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  console.log("PASS own my.view preferences restored by compare-and-swap");
}

async function main() {
  const mode = process.argv[2] ?? "inventory";
  assert.ok(["inventory", "serve", "verify-data", "restore-prefs"].includes(mode));
  const { db, dsn } = await localConnection();
  try {
    if (mode === "inventory" || mode === "serve") {
      const state = await selectState(db);
      console.log(JSON.stringify({ roles: Object.fromEntries(Object.entries(state.profiles).map(([role, profile]) =>
        [role, profile ? { available: true, activeTasks: profile.activeTasks } : { available: false }])),
        existingEntities: Boolean(state.projectPath && state.productPath) }));
      if (mode === "inventory") return;
      await mkdir(path.dirname(localStatePath), { recursive: true });
      await writeFile(localStatePath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      const runtimeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(S3_|AWS_|MINIO_|TELEGRAM_|BOT_|AUTH_|NEXTAUTH_|DATABASE_URL$)/.test(key)));
      const require = createRequire(path.resolve("package.json"));
      const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3104"], {
        env: { ...runtimeEnv, NODE_ENV: "development", DATABASE_URL: dsn, AUTH_SECRET: state.secret, AUTH_URL: localBase, AUTH_TRUST_HOST: "true", NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "inherit", windowsHide: true,
      });
      console.log("START mobile localhost:3104, signed existing sessions, approved Plugin metadata sync only");
      process.once("SIGINT", () => child.kill("SIGINT"));
      process.once("SIGTERM", () => child.kill("SIGTERM"));
      try {
        await new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", () => resolve());
        });
      } finally {
        await unlink(localStatePath);
      }
    } else {
      const state = JSON.parse(await readFile(localStatePath, "utf8")) as MobileLocalState;
      if (mode === "restore-prefs") await restorePreferences(db, state);
      assert.deepEqual(await snapshot(db), state.baseline, "business tables must remain byte-equivalent");
      console.log(`PASS unchanged counts/hashes of ${tables.length} business tables`);
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("mobile-local.ts")) {
  main().catch((error) => {
    console.error(`FAIL mobile local acceptance: ${error?.name ?? "Error"}; inspect guard/assertion without printing DSN or tokens`);
    process.exitCode = 1;
  });
}
