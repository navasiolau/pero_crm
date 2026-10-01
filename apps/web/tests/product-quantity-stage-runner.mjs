/** Root scoped staging transport; credentials never appear in command arguments/output. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runQuantityBrowser } from "./product-quantity-browser.mjs";
import { parseStagingBasicAuth } from "./work-shares-stage-browser-runner.mjs";

const root = resolve(import.meta.dirname, "../../..");
const directory = resolve(root, ".playwright-mcp/product-quantity");
const revision = process.argv[2];
assert.match(revision ?? "", /^[a-f0-9]{40}$/);
const baseline = JSON.parse(readFileSync(resolve(directory, "staging-baseline.json"), "utf8"));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const built = await build({ entryPoints: [resolve(import.meta.dirname, "product-quantity-qa-entry.mjs")],
  bundle: true, write: false, platform: "node", format: "esm", target: "node22",
  external: ["@prisma/client", "@node-rs/argon2"], logLevel: "silent" });
const bundle = Buffer.from(built.outputFiles[0].contents);
const wrapperSource = resolve(root, "deploy/acceptance/product-quantity-staging.py");
const wrapperBytes = readFileSync(wrapperSource);
const wrapperSha = createHash("sha256").update(wrapperBytes).digest("hex");
const remote = "/root/pero-product-quantity-" + wrapperSha + ".py";
execFileSync("scp", ["-q", wrapperSource, "crm-staging:" + remote], { windowsHide: true, stdio: "pipe" });
const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "crm-staging", "python3", remote],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout });
const pending = []; const queue = [];
lines.on("line", (line) => {
  let value;
  try { value = JSON.parse(line); } catch { value = { status: "STOP", code: "REMOTE_JSON_REQUIRED" }; }
  const waiter = pending.shift(); if (waiter) waiter(value); else queue.push(value);
});
child.stderr.on("data", () => {}); // Keep raw dependency/credential messages private.
const ended = new Promise((done) => child.on("exit", (code) => done(code)));
async function response() {
  let timer;
  let value;
  try {
    value = queue.length ? queue.shift() : await Promise.race([
      new Promise((done) => pending.push(done)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("STAGING_RESPONSE_DEADLINE")), 100000); }),
      ended.then(() => { throw new Error("STAGING_TRANSPORT_CLOSED"); }),
    ]);
  } finally { clearTimeout(timer); }
  assert.notEqual(value.status, "STOP", value.code ?? "STAGING_STOP");
  return value;
}
async function request(operation) {
  child.stdin.write(JSON.stringify({ operation }) + "\n");
  return response();
}
mkdirSync(directory, { recursive: true });
const resume = process.argv[3] === "resume";
const runId = resume ? JSON.parse(readFileSync(resolve(directory, "staging-resume.json"), "utf8")).runId : randomUUID();
child.stdin.write(JSON.stringify({ operation: "window", revision, runId, baselineRunId: baseline.runId,
  bundle: bundle.toString("base64"), bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  ...(resume ? { resume: true } : {}) }) + "\n");
let ready; let prepared; let cleaned = false;
try {
  ready = await response();
  assert.equal(ready.status, "STAGING_WINDOW_READY");
  writeFileSync(resolve(directory, "staging-window.json"), JSON.stringify(ready, null, 2));
  console.log(JSON.stringify({ status: ready.status, revision, tablesPreserved: ready.tablesPreserved }));
  if (resume) await request("bind-api-usage");
  prepared = await request(resume ? "resume" : "prepare");
  writeFileSync(resolve(directory, "prepare-staging.json"), JSON.stringify(prepared), { mode: 0o600 });
  const httpCredentials = parseStagingBasicAuth(readFileSync("D:/Projects/pero_crm_v2/HANDOVER-NEXT-AGENT.md", "utf8"));
  await runQuantityBrowser({ prepared, directory, target: "staging", origin: "https://staging-crm.peromebel.by", httpCredentials,
    captureRemote: async () => {
      const captured = await request("capture");
      writeFileSync(resolve(directory, "capture-staging.json"), JSON.stringify(captured), { mode: 0o600 });
      return captured;
    } });
  const cleanup = await request("cleanup");
  assert.equal(cleanup.status, "QA_CLEANED_PRESERVED"); cleaned = true;
  writeFileSync(resolve(directory, "cleanup-staging.json"), JSON.stringify(cleanup, null, 2));
  const released = await request("release");
  assert.equal(released.status, "STAGING_WINDOW_RELEASED");
  child.stdin.end(); assert.equal(await ended, 0);
  const receipt = { status: "STAGING_NATIVE_AND_PRESERVATION_PASS", revision, identity: ready.identity,
    backfill: ready.backfill, tablesPreserved: ready.tablesPreserved, cleanup, wrapperSha256: wrapperSha };
  writeFileSync(resolve(directory, "staging-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, revision, exactTables: cleanup.exactTables, deleted: cleanup.deleted }));
} catch (error) {
  writeFileSync(resolve(directory, "staging-run-failure.private.log"), String(error?.stack ?? error) +
    JSON.stringify({ ready: !!ready, prepared: !!prepared, cleaned }), { mode: 0o600 });
  // No retry of mutations after an unknown outcome. Release only the existing lock.
  if (ready) {
    try { await request("release"); } catch { /* The bounded server window stops independently. */ }
  }
  child.stdin.end();
  console.error("STAGING_QUANTITY_STOP_INSPECT_PRIVATE_STATE"); process.exitCode = 1;
}
