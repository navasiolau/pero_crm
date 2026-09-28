/** Root browser coordinator; holds the existing staging W07 lock for the UI window. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineeringStageSessions } from "./engineering-stage-runner.mjs";
import { EngineeringBrowserStop, runEngineeringBrowser } from "./engineering-browser.mjs";
import { parseStagingBasicAuth } from "./work-shares-stage-browser-runner.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
async function browserWindow(directory, revision, runId, operation) {
  // A reviewed pre-browser retry may acquire a new window only after every
  // prior window has an explicit successful release. Preserve all old proofs.
  for (const name of readdirSync(directory).filter((n) => /^window(?:-[0-9a-f-]{36})?-acquired\.json$/.test(n))) {
    const ended = join(directory, name.replace(/acquired\.json$/, "ended.json"));
    assert.ok(existsSync(ended), "PREVIOUS_WINDOW_NOT_RELEASED");
    const proof = JSON.parse(readFileSync(ended, "utf8"));
    assert.ok(proof.runId === runId && proof.released && proof.code === 0 && !proof.failed, "PREVIOUS_WINDOW_NOT_RELEASED");
  }
  const attempt = randomUUID();
  const bytes = readFileSync(join(ROOT, "deploy/acceptance/engineering-staging-window.py"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const child = spawn("C:\\Windows\\System32\\OpenSSH\\ssh.exe", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "crm-staging", "python3", `/root/pero-engineering-window-${digest}.py`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let alive = true, ready = false, released = false, tail = "", failed = false;
  let resolveReady, rejectReady;
  const readyPromise = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
  const exited = new Promise((yes) => {
    child.once("error", () => { alive = false; failed = true; rejectReady(new EngineeringBrowserStop("WINDOW_SSH_START_FAILED")); yes(null); });
    child.once("exit", (code) => { alive = false; if (!ready) rejectReady(new EngineeringBrowserStop("WINDOW_DID_NOT_START")); yes(code); });
  });
  child.stdin.on("error", () => { failed = true; });
  child.stderr.on("data", () => { failed = true; });
  child.stdout.on("data", (chunk) => {
    tail += chunk.toString("utf8");
    if (tail.length > 8192) { failed = true; rejectReady(new EngineeringBrowserStop("WINDOW_OUTPUT_INVALID")); return; }
    let split;
    while ((split = tail.indexOf("\n")) !== -1) {
      const line = tail.slice(0, split); tail = tail.slice(split + 1);
      try {
        const result = JSON.parse(line);
        if (result.status === "WINDOW_READY" && result.runId === runId && result.revision === revision) { ready = true; resolveReady(); }
        else if (result.status === "WINDOW_RELEASED" && result.runId === runId) released = true;
        else { failed = true; rejectReady(new EngineeringBrowserStop("WINDOW_GUARD_STOP")); }
      } catch { failed = true; rejectReady(new EngineeringBrowserStop("WINDOW_OUTPUT_INVALID")); }
    }
  });
  child.stdin.write(JSON.stringify({ revision, runId }) + "\n");
  const startedAt = Date.now();
  const check = () => {
    // Stop scheduling requests five minutes before the guest's maximum lease.
    if (!ready || !alive || failed || Date.now() - startedAt > 600000) throw new EngineeringBrowserStop("STAGING_WINDOW_LOST");
  };
  try {
    await readyPromise; check();
    writeFileSync(join(directory, `window-${attempt}-acquired.json`), JSON.stringify({ revision, runId, helperSha256: digest, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    return await operation(check);
  } finally {
    if (alive && ready) child.stdin.end(JSON.stringify({ release: runId }) + "\n");
    else child.stdin.end();
    const code = await exited;
    writeFileSync(join(directory, `window-${attempt}-ended.json`), JSON.stringify({ runId, released, code, failed, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    assert.ok(released && code === 0 && !failed, "STAGING_WINDOW_END_FAILED");
  }
}
async function main() {
  const [directory, ...extra] = process.argv.slice(2); assert.ok(directory && !extra.length);
  // This call checks the sealed source, private directory, backup and exact deployed revision.
  const session = await engineeringStageSessions(directory);
  const control = JSON.parse(readFileSync(join(directory, "control.json"), "utf8"));
  const credentialSource = readFileSync("D:/Projects/pero_crm_v2/HANDOVER-NEXT-AGENT.md");
  assert.equal(createHash("sha256").update(credentialSource).digest("hex"), "9baf058f1b6df6e5b6af96928c0f6b76b91cd1daf149072a8505c120eac2b75a");
  const httpCredentials = parseStagingBasicAuth(credentialSource.toString("utf8"));
  const result = await browserWindow(directory, control.seal.expectedRevision, session.plan.runId,
    (externalGuard) => runEngineeringBrowser({ baseUrl: session.origin, plan: session.plan, sessions: session,
      serverReferenceManifest: session.serverReferenceManifest, outputDir: directory, externalGuard, httpCredentials }));
  console.log(JSON.stringify({ status: result.status, runId: result.runId, checks: result.checks, screenshots: result.screenshots.length, actions: result.actions.length }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(JSON.stringify({ status: "STOP", code: /^[A-Z_]+$/.test(error.message) ? error.message : "STAGING_BROWSER_INSPECT_EVIDENCE" })); process.exitCode = 1;
});
