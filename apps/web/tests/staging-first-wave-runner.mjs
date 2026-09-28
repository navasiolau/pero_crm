/** Root-only local acceptance coordinator. Never prints credentials or sessions. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const revision = "a1123c5f8a498dc916a67e609a4a550720367fc2";
const operation = process.argv[2];
if (!["readonly", "browser", "inspect", "restore"].includes(operation)) throw new Error("Explicit acceptance operation required");
const runDir = path.join(root, ".playwright-mcp", "staging-first-wave", randomUUID());
await mkdir(runDir, { recursive: true });
const wrapper = await readFile(path.join(root, "deploy/acceptance/staging-first-wave.py"));
const wrapperSha256 = createHash("sha256").update(wrapper).digest("hex");
const remoteWrapper = `/root/pero-crm-acceptance-${wrapperSha256}.py`;

class SafeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function remote(entry, op, input) {
  const built = await build({ entryPoints: [path.join(here, entry)], bundle: true, write: false,
    platform: "node", format: "esm", target: "node22", external: ["@prisma/client"], logLevel: "silent" });
  const bundle = Buffer.from(built.outputFiles[0].contents);
  const packet = { revision, operation: op, bundle: bundle.toString("base64"),
    bundleSha256: createHash("sha256").update(bundle).digest("hex"), ...(input ? { input } : {}) };
  const process = spawn("ssh", ["-T", "-o", "BatchMode=yes", "crm-staging", "python3", remoteWrapper],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [];
  let size = 0;
  let oversized = false;
  process.stdout.on("data", (chunk) => {
    size += chunk.length;
    if (size > 512 * 1024) oversized = true;
    else stdout.push(chunk);
  });
  process.stderr.resume(); // Never forward remote dependency errors/secrets.
  const completion = new Promise((resolve, reject) => {
    process.on("error", () => reject(new SafeFailure("SSH_START_FAILED")));
    process.on("exit", (code) => resolve(code));
  });
  process.stdin.on("error", () => {});
  process.stdin.end(JSON.stringify(packet));
  const code = await completion;
  if (oversized) throw new SafeFailure("REMOTE_OUTPUT_TOO_LARGE");
  let result;
  try { result = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
  catch { throw new SafeFailure("REMOTE_JSON_REQUIRED"); }
  if (code !== 0) {
    if (op !== "prepare") {
      await writeFile(path.join(runDir, `${op}-failure.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
    }
    // Remote codes are constant labels; don't echo arbitrary stderr or body.
    const safe = result.code ?? result.result?.failure?.code ?? result.result?.code;
    throw new SafeFailure(typeof safe === "string" && /^[A-Z_0-9]+$/.test(safe) ? safe : "REMOTE_ACCEPTANCE_FAILED");
  }
  if (result.identity?.revision !== revision || result.identity?.hostname !== "crm-staging") {
    throw new SafeFailure("REMOTE_IDENTITY_PROOF_REQUIRED");
  }
  return result;
}

async function basicAuth() {
  // The owner's protected handover is the existing credential source, not a
  // guessed password. Only this local browser process receives these values.
  const handover = await readFile("D:/Projects/pero_crm_v2/HANDOVER-NEXT-AGENT.md", "utf8");
  const line = handover.split(/\r?\n/).find((value) => value.startsWith("- Basic auth staging:"));
  const fields = [...(line ?? "").matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  if (fields.length !== 3 || !fields[0] || !fields[1]) throw new SafeFailure("BASIC_CREDENTIAL_SOURCE_INVALID");
  return { username: fields[0], password: fields[1] };
}

async function main() {
  if (operation === "inspect" || operation === "restore") {
    const previousDir = path.resolve(process.argv[3] ?? "");
    const allowedParent = path.join(root, ".playwright-mcp", "staging-first-wave") + path.sep;
    if (!previousDir.startsWith(allowedParent)) throw new SafeFailure("PREVIOUS_OWNED_RUN_REQUIRED");
    const checkpoint = JSON.parse(await readFile(path.join(previousDir, "checkpoint.json"), "utf8"));
    const ownWrites = JSON.parse(await readFile(path.join(previousDir, "own-writes.json"), "utf8"));
    const receipt = await remote("staging-browser-session.mjs", operation, { operation, checkpoint, ownWrites });
    await writeFile(path.join(runDir, `${operation}-result.json`), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: receipt.result.status, revision, mode: operation, runDir }));
    return;
  }
  if (operation === "readonly") {
    const receipt = await remote("staging-first-wave-readonly.mjs", "readonly");
    await writeFile(path.join(runDir, "readonly-result.json"), JSON.stringify({ wrapperSha256, ...receipt }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: receipt.result.status, revision, mode: operation,
      completedChecks: receipt.result.checks.length, dataIntegrity: receipt.result.dataIntegrity.status, runDir }));
    return;
  }
  const prepared = await remote("staging-browser-session.mjs", "prepare", { operation: "prepare" });
  const session = prepared.result;
  if (!session.checkpoint || !session.profiles) throw new SafeFailure("BROWSER_PREPARE_CONTRACT_INVALID");
  await writeFile(path.join(runDir, "checkpoint.json"), JSON.stringify(session.checkpoint), { flag: "wx", mode: 0o600 });
  let browserResult;
  let browserFailed = false;
  let restore;
  try {
    const { runBrowserAcceptance } = await import("./staging-first-wave-browser.mjs");
    const viewportWidths = process.env.CRM_STAGE_QA_WIDTHS?.split(",").map(Number);
    browserResult = await runBrowserAcceptance({ session, basicAuth: await basicAuth(), outputDir: runDir,
      ...(viewportWidths ? { viewportWidths } : {}) });
    browserFailed = browserResult.status !== "PASS";
  } catch (error) {
    browserResult = error?.result;
    browserFailed = true;
  } finally {
    if (browserResult) await writeFile(path.join(runDir, "browser-attempt.json"), JSON.stringify(browserResult, null, 2), { flag: "wx", mode: 0o600 });
    let ownWrites = browserResult?.ownWrites ?? [];
    try { ownWrites = JSON.parse(await readFile(path.join(runDir, "own-writes.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new SafeFailure("OWN_WRITES_JOURNAL_UNREADABLE"); }
    restore = await remote("staging-browser-session.mjs", "restore", {
      operation: "restore", checkpoint: session.checkpoint, ownWrites,
    });
    await writeFile(path.join(runDir, "restore-result.json"), JSON.stringify(restore, null, 2), { flag: "wx", mode: 0o600 });
  }
  const receipt = { revision, wrapperSha256, mode: operation, status: browserFailed ? "FAIL" : "PASS",
    checks: browserResult?.checks ?? [], screenshots: browserResult?.screenshots ?? [],
    restore: restore.result, authentication: "SIGNED_EXISTING_STAGING_SESSIONS", passwordLogin: "NOT_TESTED" };
  await writeFile(path.join(runDir, "browser-result.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: receipt.status, revision, mode: operation, checks: receipt.checks.length, runDir }));
  if (browserFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "STOP", mode: operation,
    code: error instanceof SafeFailure ? error.code : "LOCAL_ACCEPTANCE_FAILED", runDir }));
  process.exitCode = 1;
});
