/** Explicit loopback runtime for the approved existing local database. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { openSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const web = resolve(root, "apps/web");
assert.equal(process.platform, "win32");
assert.ok(root.toLowerCase().endsWith("\\worktrees\\product-quantity\\pero_crm_v2"));
const [container] = JSON.parse(execFileSync("docker", ["inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
assert.equal(container.Id, "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5");
assert.equal(container.State.Running, true);
const before = Object.fromEntries(container.Config.Env.map((entry) => { const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)]; }));
assert.equal(before.POSTGRES_DB, "pero_crm"); assert.equal(before.POSTGRES_USER, "pero");
const url = new URL("postgresql://127.0.0.1:5433/pero_crm"); url.username = "pero"; url.password = before.POSTGRES_PASSWORD;
process.loadEnvFile(resolve(root, ".playwright-mcp/product-quantity/local.env"));
const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const stdout = openSync(resolve(root, ".playwright-mcp/product-quantity/runtime.private.log"), "a", 0o600);
const child = spawn(process.execPath, [next, "start", "--port", "3116", "--hostname", "127.0.0.1"], {
  cwd: web, windowsHide: true, env: { ...process.env, DATABASE_URL: url.href, AUTH_URL: "http://127.0.0.1:3116",
    AUTH_TRUST_HOST: "true", NODE_ENV: "production" }, stdio: ["ignore", stdout, stdout],
});
child.on("error", () => { console.error("LOCAL_RUNTIME_START_FAILED"); process.exitCode = 1; });
child.on("exit", (code) => { console.log("LOCAL_RUNTIME_STOPPED"); process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
console.log(JSON.stringify({ status: "LOCAL_RUNTIME_STARTED", origin: "http://127.0.0.1:3116", pid: child.pid }));
