/** One reviewed read-only staging page diagnosis. No money POST is forwarded. */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { cashStageOperation, validateCashStageSeal } from "./cash-stage-runner.mjs";
import { withCashStageWindow } from "./cash-stage-browser-runner.mjs";
import { cashAuthCookies, cashManagerSessionMatches, validateCashBrowserBinding } from "./cash-qa-browser.mjs";

const SELF = fileURLToPath(import.meta.url), STAGE = "https://staging-crm.peromebel.by";
const RUN_ID = "8d7055e1-560a-4c0d-969a-b2f6193deaa2";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const check = (ok, code) => { if (!ok) throw new Error(code); };
const READ_PATHS = new Set(["/advances", "/api/auth/session", "/login", "/", "/favicon.ico",
  "/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/sw.js"]);

export function validateStagePageRequest({ url, method, headers = {} }) {
  const parsed = new URL(url);
  check(parsed.origin === STAGE, "PAGE_DIAGNOSTIC_CROSS_ORIGIN_FORBIDDEN");
  if (method !== "GET") return { kind: "abort-write", path: parsed.pathname };
  if (headers["next-router-prefetch"] || headers.purpose === "prefetch") return { kind: "abort-prefetch" };
  check(READ_PATHS.has(parsed.pathname) || parsed.pathname.startsWith("/_next/") ||
    parsed.pathname.startsWith("/icons/"), "PAGE_DIAGNOSTIC_GET_FORBIDDEN");
  return { kind: "continue", path: parsed.pathname };
}

function privateDir(value) {
  check(typeof value === "string" && existsSync(value) && lstatSync(value).isDirectory() &&
    !lstatSync(value).isSymbolicLink(), "PAGE_DIAGNOSTIC_PRIVATE_DIR_REQUIRED");
  const directory = realpathSync(value);
  check(dirname(directory).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    basename(directory).startsWith("pero-cash-qa-staging-"), "PAGE_DIAGNOSTIC_PRIVATE_DIR_FORBIDDEN");
  return directory;
}
function readState(directory, name) {
  const file = join(directory, name);
  check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),
    "PAGE_DIAGNOSTIC_STATE_MISSING");
  return JSON.parse(readFileSync(file, "utf8"));
}
function save(directory, name, value) {
  const file = join(directory, name), bytes = Buffer.from(JSON.stringify(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "PAGE_DIAGNOSTIC_READBACK_FAILED");
}
function safePath(value) {
  try { const url = new URL(value, STAGE); return url.origin === STAGE ? url.pathname : "OTHER_ORIGIN"; }
  catch { return "INVALID_URL"; }
}

export async function runCashStagePageDiagnostic(inputDirectory) {
  const directory = privateDir(inputDirectory), seal = validateCashStageSeal(readState(directory, "control.json").seal);
  const plan = readState(directory, "plan.json"), initial = readState(directory, "captured-initial.json");
  check(plan.runId === RUN_ID && initial.phase === "INITIAL" &&
    !["stage-page-diagnostic-intent.json", "stage-page-diagnostic-session.json", "stage-page-diagnostic-result.json",
      "stage-page-diagnostic-drained.json", "stage-page-diagnostic-after.json", "stage-page-diagnostic-360.png"]
      .some((name) => existsSync(join(directory, name))), "PAGE_DIAGNOSTIC_ALREADY_ATTEMPTED");
  const pre = await cashStageOperation({ operation: "verify", directory, captureName: "initial" });
  check(pre.graphHash === initial.graphHash, "PAGE_DIAGNOSTIC_PRE_GRAPH_DRIFT");
  const sessions = await cashStageOperation({ operation: "sessions", directory });
  validateCashBrowserBinding({ baseUrl: STAGE, plan, sessions });
  const manager = sessions.sessions[0];
  const auth = readState(directory, "basic-auth.json");
  check(manager.role === "manager" && manager.userId === plan.actors.managerId &&
    typeof auth.username === "string" && auth.username.length > 0 &&
    typeof auth.password === "string" && auth.password.length > 0, "PAGE_DIAGNOSTIC_SESSION_OR_AUTH_INVALID");
  save(directory, "stage-page-diagnostic-intent.json", { runId: RUN_ID, kind: "READ_ONLY_GET",
    paths: ["/api/auth/session", "/advances"], graphHash: initial.graphHash, at: new Date().toISOString() });
  let result;
  try {
    result = await withCashStageWindow(directory, seal.expectedRevision, seal.windowSha256, async (externalGuard) => {
      let browser, context, draining = false, blockedPosts = 0, failure = null;
      const handlers = new Set(), navigation = [];
      try {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ viewport: { width: 360, height: 800 }, httpCredentials: auth,
          serviceWorkers: "block" });
        await context.addCookies(cashAuthCookies(manager, STAGE));
        await context.route("**/*", (route) => {
          const pending = (async () => {
            try {
              externalGuard();
              const request = route.request();
              const decision = validateStagePageRequest({ url: request.url(), method: request.method(),
                headers: request.headers() });
              if (draining || decision.kind === "abort-prefetch") { await route.abort("blockedbyclient"); return; }
              if (decision.kind === "abort-write") { blockedPosts++; await route.abort("blockedbyclient"); return; }
              await route.continue();
            } catch (error) {
              failure = error instanceof Error ? error.message : "PAGE_DIAGNOSTIC_ROUTE_FAILURE";
              await route.abort("blockedbyclient").catch(() => {});
            }
          })();
          handlers.add(pending); void pending.finally(() => handlers.delete(pending));
          return pending;
        });
        const page = await context.newPage();
        page.on("response", (response) => {
          if (!response.request().isNavigationRequest()) return;
          navigation.push({ path: safePath(response.url()), status: response.status(),
            locationPath: safePath(response.headers()["location"] ?? response.url()) });
        });
        externalGuard();
        const sessionResponse = await context.request.get(`${STAGE}/api/auth/session`,
          { maxRedirects: 0, timeout: 20000 });
        const sessionStatus = sessionResponse.status();
        const contentType = String(sessionResponse.headers()["content-type"] ?? "").slice(0, 100);
        let sessionBody = null;
        if (sessionStatus === 200 && contentType.includes("json")) {
          try { sessionBody = await sessionResponse.json(); } catch { /* Save status/content type even for invalid JSON. */ }
        }
        const userPresent = Boolean(sessionBody?.user);
        const { idMatches, hasManagerRole } = cashManagerSessionMatches(sessionBody, manager.userId);
        const sessionValid = sessionStatus === 200 && idMatches && hasManagerRole;
        save(directory, "stage-page-diagnostic-session.json", { runId: RUN_ID, status: sessionStatus,
          contentType, userPresent, idMatches, hasManagerRole });
        check(sessionValid, "PAGE_DIAGNOSTIC_MANAGER_SESSION_INVALID");
        externalGuard();
        const initialResponse = await page.goto(`${STAGE}/advances`,
          { waitUntil: "domcontentloaded", timeout: 30000 });
        const advancesHeading = page.getByRole("heading", { name: "Выдача аванса" });
        let headingVisible = false, advancesHeadingCount = 0;
        try {
          await advancesHeading.waitFor({ state: "visible", timeout: 30000 });
          headingVisible = true;
          advancesHeadingCount = await advancesHeading.count();
          check(advancesHeadingCount === 1, "PAGE_DIAGNOSTIC_ADVANCES_HEADING_AMBIGUOUS");
        } catch (error) {
          if (error instanceof Error && error.message === "PAGE_DIAGNOSTIC_ADVANCES_HEADING_AMBIGUOUS") throw error;
          /* Capture final URL/title/screenshot even when the heading is absent. */
        }
        externalGuard();
        const title = await page.title();
        const headings = await page.locator("h1,h2").allTextContents();
        const knownHeadings = headings.filter((value) => ["Выдача аванса", "Вход", "Авторизация"].includes(value.trim()));
        const screenshot = join(directory, "stage-page-diagnostic-360.png");
        check(!existsSync(screenshot), "PAGE_DIAGNOSTIC_SCREENSHOT_EXISTS");
        await page.screenshot({ path: screenshot, fullPage: true });
        check(!failure, "PAGE_DIAGNOSTIC_ROUTE_FAILURE");
        return { status: headingVisible ? "PAGE_VISIBLE" : "PAGE_HEADING_MISSING", runId: RUN_ID,
          managerSession: { status: sessionStatus, idMatches, hasManagerRole },
          firstRequestPath: "/advances", firstResponseStatus: initialResponse?.status() ?? null,
          navigation, finalPath: safePath(page.url()), title: title.length <= 100 ? title : "TITLE_TOO_LONG",
          headingVisible, advancesHeadingCount, knownHeadings, headingCount: headings.length, blockedPosts,
          screenshot: "stage-page-diagnostic-360.png", screenshotSha256: sha(readFileSync(screenshot)) };
      } finally {
        draining = true;
        let actionsDrained = false, contextsClosed = false;
        try { while (handlers.size) await Promise.allSettled([...handlers]); actionsDrained = true;
          await context?.close(); await browser?.close(); contextsClosed = true; }
        catch { failure ??= "PAGE_DIAGNOSTIC_DRAIN_FAILED"; }
        save(directory, "stage-page-diagnostic-drained.json", { runId: RUN_ID, actionsDrained,
          contextsClosed, inFlight: handlers.size, blockedPosts, failure });
      }
    });
    save(directory, "stage-page-diagnostic-result.json", result);
  } finally {
    const after = await cashStageOperation({ operation: "verify", directory, captureName: "initial" });
    save(directory, "stage-page-diagnostic-after.json", { runId: RUN_ID, graphHash: after.graphHash,
      sameAsBefore: after.graphHash === initial.graphHash, at: new Date().toISOString() });
    check(after.graphHash === initial.graphHash, "PAGE_DIAGNOSTIC_FOREIGN_DRIFT");
  }
  return { status: result.status, finalPath: result.finalPath, firstResponseStatus: result.firstResponseStatus,
    headingVisible: result.headingVisible, managerSession: result.managerSession,
    screenshot: result.screenshot, graphHash: initial.graphHash };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SELF).toLowerCase()) {
  const [directory, ...extra] = process.argv.slice(2);
  void (async () => { check(directory && !extra.length, "PAGE_DIAGNOSTIC_USAGE_INVALID");
    return runCashStagePageDiagnostic(directory); })().then((value) => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch((error) => { const code = error instanceof Error ? error.message : "";
      process.stderr.write(`${JSON.stringify({ status: "STOP", code: /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code :
        "PAGE_DIAGNOSTIC_FAILED_INSPECT" })}\n`);
      process.exitCode = 1;
    });
}
