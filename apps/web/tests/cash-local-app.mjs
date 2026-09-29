/** Foreground local QA app; import opens no connection, browser, child or file. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { inspectCashLocalBuild, inspectCashLocalRuntimeInput, inspectCashPrestart } from "./cash-qa-runner.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), "..");
const ORIGIN = "http://127.0.0.1:3106", PORT = 3106;
const REQUIRE = createRequire(import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const check = (ok, code) => { if (!ok) throw new Error(code); };

export function cashAppEnvironment(source, datasourceUrl, secret) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp"]);
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase()))),
    NODE_ENV: "production", DATABASE_URL: datasourceUrl, AUTH_SECRET: secret, AUTH_URL: ORIGIN,
    NEXT_TELEMETRY_DISABLED: "1", PORT: String(PORT), HOSTNAME: "127.0.0.1" };
}

function save(directory, name, value) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n"), file = join(directory, name);
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "RUNTIME_RECEIPT_READBACK_FAILED");
}

async function portUnbound() {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: PORT });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve(true) : reject(error));
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error("PORT_PROBE_TIMEOUT")); });
  });
}

async function ready(child) {
  for (let attempt = 0; attempt < 30; attempt++) {
    check(child.exitCode === null && !child.killed, "RUNTIME_EXITED_BEFORE_READY");
    try {
      const response = await fetch(`${ORIGIN}/api/auth/session`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
      if (response.status === 200 && response.headers.get("content-type")?.includes("json")) return;
    } catch { /* Bounded read-only readiness probe. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("RUNTIME_READINESS_TIMEOUT");
}

/** Root keeps this command session foreground and ends it with Ctrl-C after capture. */
export async function serveCashLocalApp(migrationPath, prestartPath) {
  const input = inspectCashLocalRuntimeInput(migrationPath);
  const state = inspectCashPrestart(prestartPath, input), build = inspectCashLocalBuild(), directory = state.directory;
  check(!["runtime-intent.json", "runtime-started.json", "runtime-stopped.json", "auth-secret.json"]
    .some((name) => existsSync(join(directory, name))) && await portUnbound(), "RUNTIME_ALREADY_ATTEMPTED_OR_PORT_BUSY");
  const secretBytes = randomBytes(48), secret = secretBytes.toString("base64"), secretDigest = sha(secretBytes);
  save(directory, "auth-secret.json", { value: secret, digest: secretDigest });
  secretBytes.fill(0);
  save(directory, "runtime-intent.json", { origin: ORIGIN, build, runId: state.runId,
    migrationReceiptSha256: state.migrationReceiptSha256, at: new Date().toISOString() });
  const stdout = openSync(join(directory, "runtime.out"), "wx", 0o600);
  const stderr = openSync(join(directory, "runtime.err"), "wx", 0o600);
  let child, exited, requestedStop = false;
  const interrupt = () => { requestedStop = true; if (child?.exitCode === null) child.kill("SIGTERM"); };
  try {
    child = spawn(process.execPath, [REQUIRE.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(PORT)],
      { cwd: WEB, env: cashAppEnvironment(process.env, input.target.datasourceUrl, secret),
        windowsHide: true, stdio: ["ignore", stdout, stderr] });
    exited = new Promise((resolve) => {
      child.once("error", () => resolve({ code: null, spawnFailed: true }));
      child.once("exit", (code) => resolve({ code, spawnFailed: false }));
    });
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    await ready(child);
    check(Number.isSafeInteger(child.pid) && child.pid > 0, "RUNTIME_PID_INVALID");
    save(directory, "runtime-started.json", { pid: child.pid, launcherPid: process.pid, origin: ORIGIN,
      build, secretDigest, migrationReceiptSha256: state.migrationReceiptSha256, at: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify({ status: "RUNTIME_READY", pid: child.pid, origin: ORIGIN, buildId: build.buildId })}\n`);
    const result = await exited;
    save(directory, "runtime-stopped.json", { pid: child.pid, code: result.code, requestedStop,
      spawnFailed: result.spawnFailed, at: new Date().toISOString() });
    check(!result.spawnFailed && (requestedStop || result.code === 0), "RUNTIME_EXIT_UNEXPECTED");
    return { status: "RUNTIME_STOPPED", pid: child.pid };
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    try {
      if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
      const finalResult = exited ? await Promise.race([exited, new Promise((_, reject) =>
        setTimeout(() => reject(new Error("CHILD_SHUTDOWN_UNCONFIRMED")), 15000))]) : null;
      if (finalResult && Number.isSafeInteger(child?.pid) && child.pid > 0 && !existsSync(join(directory, "runtime-stopped.json")))
        save(directory, "runtime-stopped.json", { pid: child.pid, code: finalResult.code, requestedStop,
          spawnFailed: finalResult.spawnFailed, started: existsSync(join(directory, "runtime-started.json")),
          at: new Date().toISOString() });
    } finally { closeSync(stdout); closeSync(stderr); }
  }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SELF).toLowerCase()) {
  const [operation, migrationPath, prestartPath, ...extra] = process.argv.slice(2);
  void (async () => { check(operation === "serve" && migrationPath && prestartPath && !extra.length, "USAGE_INVALID");
    return serveCashLocalApp(migrationPath, prestartPath); })().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { const message = error instanceof Error ? error.message : "";
      process.stderr.write(`${JSON.stringify({ status: "STOP", code: /^[A-Z][A-Z0-9_]{2,100}$/.test(message)
        ? message : "RUNTIME_FAILED_INSPECT_PRIVATE_LOG" })}\n`);
      process.exitCode = 1;
    });
}
