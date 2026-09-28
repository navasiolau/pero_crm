import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Client } from "pg";
import { encode } from "@auth/core/jwt";
import type { Role } from "@prisma/client";
import { homePathForRoles } from "../src/lib/home-route";

// Owner-approved local DB. No fixtures, schema changes, passwords or roles are written.
const containerName = "pero_crm_pg";
const containerId = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const base = new URL("http://localhost:3102");
const cookieName = "authjs.session-token";
const statePath = path.resolve("../../.playwright-mcp/dashboard-local-state.json");
const browserScriptPath = path.resolve(process.env.PERO_CRM_BROWSER_ARTIFACT_ROOT ?? path.dirname(statePath), "dashboard-management-local-browser-run.js");
const businessTables = ["User", "Client", "Project", "Product", "Task", "Work", "File", "Payment", "Payout", "PayrollEntry", "Material", "ProjectMaterial", "StockMovement"];
type Profile = { id: string; roles: Role[]; sessionVersion: number };
type TestState = { secret: string; profiles: Profile[]; cookies: string[]; baseline: Record<string, unknown> };

async function guardedLocal() {
  const [container] = JSON.parse(execFileSync("docker", ["inspect", containerName], { encoding: "utf8" }));
  assert.equal(container.Id, containerId);
  assert.equal(container.Name, `/${containerName}`);
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
  for (const filename of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
    assert.equal(existsSync(path.resolve(filename)), false, "refuse ambient runtime env");
    assert.equal(existsSync(path.resolve("../..", filename)), false, "refuse ambient workspace env");
  }
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = env.POSTGRES_USER;
  url.password = env.POSTGRES_PASSWORD;
  const db = new Client({ connectionString: url.href, options: "-c default_transaction_read_only=on" });
  await db.connect();
  try {
    const { rows: [identity] } = await db.query("SELECT current_database() AS name, current_user AS username, current_setting('transaction_read_only') AS readonly");
    assert.deepEqual(identity, { name: "pero_crm", username: "pero", readonly: "on" });
  } catch (error) {
    await db.end();
    throw error;
  }
  console.log("PASS guard: exact existing local container/volume, loopback5433/pero_crm, read-only harness connection");
  return { db, dsn: url.href };
}

async function snapshot(db: Client) {
  const result: Record<string, unknown> = {};
  for (const table of businessTables) {
    // Fixed identifiers only, no external SQL fragments.
    const { rows: [summary] } = await db.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) AS hash FROM "${table}" t`);
    result[table] = summary;
  }
  return result;
}

async function signedCookie(profile: Profile, secret: string, stale = false) {
  return encode({
    token: { id: profile.id, roles: profile.roles, sessionVersion: profile.sessionVersion + (stale ? 1 : 0) },
    secret, salt: cookieName, maxAge: 1800,
  });
}

async function request(route: string, cookie?: string) {
  return fetch(new URL(route, base), { redirect: "manual", signal: AbortSignal.timeout(60000), headers: cookie ? { cookie: `${cookieName}=${cookie}` } : {} });
}

async function httpAcceptance(state: TestState) {
  assert.equal((await request("/api/health")).status, 200);
  const anonymous = await request("/");
  assert.equal(new URL(anonymous.headers.get("location")!, base).pathname, "/login");
  for (let i = 0; i < state.profiles.length; i++) {
    const profile = state.profiles[i];
    const cookie = state.cookies[i];
    const roles = profile.roles.join("+");
    const home = homePathForRoles(profile.roles);
    const current = await (await request("/api/auth/session", cookie)).json();
    assert.equal(current?.user?.id, profile.id);
    assert.deepEqual(current.user.roles, profile.roles);
    const root = await request("/", cookie);
    if (home === "/") {
      assert.equal(root.status, 200);
      assert.match(await root.text(), /Проекты в работе/);
    } else {
      assert.ok([302, 303, 307, 308].includes(root.status));
      assert.equal(new URL(root.headers.get("location")!, base).href, new URL(home, base).href);
      assert.doesNotMatch(await root.text(), /Проекты в работе/);
      assert.equal((await request(home, cookie)).status, 200);
    }
    const activeLogin = await request("/login", cookie);
    assert.ok([302, 303, 307, 308].includes(activeLogin.status));
    assert.equal(new URL(activeLogin.headers.get("location")!, base).href, new URL(home, base).href);
    if (profile.roles.includes("DIRECTOR")) {
      const payroll = await request("/payroll", cookie);
      assert.ok([302, 303, 307, 308].includes(payroll.status));
      assert.equal(new URL(payroll.headers.get("location")!, base).href, base.href);
    }
    const wrongVersion = await request("/", await signedCookie(profile, state.secret, true));
    assert.equal(new URL(wrongVersion.headers.get("location")!, base).pathname, "/login");
    console.log(`PASS HTTP signed test session (${roles}): DB-validated identity/roles/version; / -> ${home}; active /login; mismatched version denied`);
  }
}

async function main() {
  const mode = process.argv[2] ?? "http";
  assert.ok(["guard", "profiles", "serve", "http", "verify-data", "browser-script"].includes(mode));
  const { db, dsn } = await guardedLocal();
  try {
    if (mode === "guard") return;
    if (mode === "profiles") {
      const { rows } = await db.query('SELECT roles, active, count(*)::int AS count FROM "User" GROUP BY roles, active ORDER BY roles::text, active');
      console.log(JSON.stringify(rows));
      return;
    }
    if (mode === "serve") {
      const { rows } = await db.query<Profile>('SELECT id, roles::text[] AS roles, "sessionVersion" FROM "User" WHERE active=true ORDER BY id');
      const profiles = [...new Map(rows.map((profile) => [[...profile.roles].sort().join("+"), profile])).values()];
      for (const role of ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT", "WORKER", "MOUNTER"]) {
        assert.ok(profiles.some((profile) => profile.roles.length === 1 && profile.roles[0] === role), `existing ${role} profile required`);
      }
      const secret = randomBytes(48).toString("base64url");
      const state: TestState = { secret, profiles, cookies: await Promise.all(profiles.map((profile) => signedCookie(profile, secret))), baseline: await snapshot(db) };
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      const runtimeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(S3_|AWS_|MINIO_|TELEGRAM_|BOT_|AUTH_|NEXTAUTH_|DATABASE_URL$)/.test(key)));
      const require = createRequire(import.meta.url);
      const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3102"], {
        env: { ...runtimeEnv, NODE_ENV: "development", DATABASE_URL: dsn, AUTH_SECRET: secret, AUTH_URL: base.origin, AUTH_TRUST_HOST: "true", NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "inherit", windowsHide: true,
      });
      console.log(`START ${profiles.length} real role combinations; signed test sessions only; approved normal Plugin metadata sync`);
      process.once("SIGINT", () => child.kill("SIGINT"));
      process.once("SIGTERM", () => child.kill("SIGTERM"));
      try {
        await new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", () => resolve());
        });
      } finally {
        await unlink(statePath);
        if (existsSync(browserScriptPath)) await unlink(browserScriptPath);
      }
    } else {
      const state = JSON.parse(await readFile(statePath, "utf8")) as TestState;
      if (mode === "browser-script") {
        const callback = await readFile(path.resolve("tests/management-dashboard-local-browser.js"), "utf8");
        const browserState = { profiles: state.profiles.map(({ roles }) => ({ roles })), cookies: state.cookies };
        await mkdir(path.dirname(browserScriptPath), { recursive: true });
        await writeFile(browserScriptPath, `async (page) => (${callback})(page, ${JSON.stringify(browserState)})`, { mode: 0o600 });
        console.log("PASS private browser runner generated; test cookies remain in ignored local file");
      }
      if (mode === "http") await httpAcceptance(state);
      const after = await snapshot(db);
      assert.deepEqual(after, state.baseline, "business tables must remain byte-equivalent");
      if (mode === "verify-data") {
        const report = {
          checkedAt: new Date().toISOString(), database: "localhost:5433/pero_crm", containerId,
          signedTestSessions: true, passwordLoginTested: false,
          roleCombinations: state.profiles.map(({ roles }) => [...roles].sort().join("+")),
          fixturesCreated: false, schemaChanged: false, applicationStartupPluginMetadataSync: true,
          unchangedBusinessTables: businessTables.length, baseline: state.baseline, after,
        };
        await writeFile(path.resolve("../../openspec/changes/management-dashboard/local-existing-db-acceptance.json"), JSON.stringify(report, null, 2) + "\n");
      }
      console.log(`PASS unchanged row counts and hashes for ${businessTables.length} business tables`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  // Deliberately exclude driver text, DSN, real user names, passwords and test tokens.
  console.error(`FAIL local dashboard acceptance: ${error?.name ?? "Error"}; check guard/assertion`);
  process.exitCode = 1;
});
