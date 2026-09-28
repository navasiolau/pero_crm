/** Root-only local bootstrap/browser. Existing DB, no fixtures or migrations here. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectEngineeringLocalTarget, createEngineeringLocalSessions } from "./engineering-local-runner.mjs";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), ".."), BASE = "http://127.0.0.1:3106";
const require = createRequire(import.meta.url);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
function save(file, data) {
  const bytes = JSON.stringify(data, null, 2) + "\n", fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  assert.equal(readFileSync(file, "utf8"), bytes);
}
function privateDir() {
  const dir = mkdtempSync(join(tmpdir(), "pero-engineering-runtime-"));
  const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-\d+(?:-\d+)+/g);
  assert.equal(sid?.length, 1);
  execFileSync("icacls", [dir, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], { windowsHide: true, stdio: "pipe" });
  return dir;
}
async function main() {
  const [op, directory, stateDir] = process.argv.slice(2);
  const target = inspectEngineeringLocalTarget();
  if (op === "serve") {
    assert.equal(directory, undefined); assert.ok(existsSync(join(WEB, ".next/BUILD_ID")));
    const dir = privateDir(), secret = randomBytes(48).toString("base64url");
    save(join(dir, "secret.json"), { secret });
    const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath", "appdata", "localappdata", "temp", "tmp"]);
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => allowed.has(k.toLowerCase()))),
      NODE_ENV: "production", DATABASE_URL: target.datasourceUrl, AUTH_SECRET: secret, AUTH_URL: BASE, AUTH_TRUST_HOST: "true", NEXT_TELEMETRY_DISABLED: "1" };
    const out = openSync(join(dir, "server.out"), "wx", 0o600), err = openSync(join(dir, "server.err"), "wx", 0o600);
    const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3106"], { cwd: WEB, env, windowsHide: true, stdio: ["ignore", out, err] });
    closeSync(out); closeSync(err);
    save(join(dir, "runtime.json"), { pid: child.pid, baseUrl: BASE, identity: target.identity, buildId: readFileSync(join(WEB, ".next/BUILD_ID"), "utf8").trim() });
    console.log(JSON.stringify({ status: "STARTING", directory: dir, pid: child.pid, baseUrl: BASE }));
    process.once("SIGINT", () => child.kill("SIGINT")); process.once("SIGTERM", () => child.kill("SIGTERM"));
    const exitCode = await new Promise((res, rej) => { child.once("error", rej); child.once("exit", res); });
    save(join(dir, "stopped.json"), { exitCode, at: new Date().toISOString() }); return;
  }
  assert.ok(op === "browser" && directory && stateDir);
  const runtimeDir = realpathSync(directory);
  assert.equal(dirname(runtimeDir).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(runtimeDir.includes("pero-engineering-runtime-"));
  const runtime = read(join(runtimeDir, "runtime.json"));
  assert.deepEqual(runtime.identity, target.identity); assert.equal(runtime.baseUrl, BASE);
  process.env.QA_AUTH_SECRET = read(join(runtimeDir, "secret.json")).secret;
  const issued = await createEngineeringLocalSessions(stateDir);
  delete process.env.QA_AUTH_SECRET;
  const { runEngineeringBrowser } = await import("./engineering-browser.mjs");
  const result = await runEngineeringBrowser({ baseUrl: BASE, plan: issued.plan, sessions: { origin: issued.origin, sessions: issued.sessions }, outputDir: stateDir });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(JSON.stringify({ status: "STOP", code: /^[A-Z_]+$/.test(error.message) ? error.message : "LOCAL_ACCEPTANCE_INSPECT_PRIVATE_EVIDENCE" })); process.exitCode = 1;
});
