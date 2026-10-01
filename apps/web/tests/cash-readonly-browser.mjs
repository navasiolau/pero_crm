/** Opt-in read-only finance/access browser check. Import creates no browser or files. */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { assertCashQaTarget } from "./cash-owned-fixtures.mjs";
import { cashActionIds, cashActionOutcome, validateCashBrowserBinding, validateCashPreview, CashBrowserStop } from "./cash-qa-browser.mjs";

const LOCAL = "http://127.0.0.1:3106";
const AUTH_REDIRECT_ORIGINS = new Set([LOCAL, "http://localhost:3106"]);
const ROLES = ["manager", "finance", "worker"];
const READ_PAGES = new Set(["/", "/my", "/advances", "/finance/payroll", "/finance/payroll/export", "/api/auth/session", "/login"]);
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const sha = (value) => createHash("sha256").update(value).digest("hex");
function check(ok, code) { if (!ok) throw new CashBrowserStop(code); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function errorClass(error) {
  const name = error?.constructor?.name ?? "Error";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
}
export function readonlyErrorDiagnostic(phase, error, code) {
  const detail = String(error?.message ?? "")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(?:__Secure-)?authjs\.session-token(?:\s*[:=]\s*|\s+)\S+/gi, "[COOKIE]")
    .replace(/\b(password|token|secret|authorization|cookie|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 240);
  return { phase, errorClass: errorClass(error), code, detail };
}
function staticGet(path) { return path.startsWith("/_next/") || path.startsWith("/icons/") ||
  ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/sw.js"].includes(path); }
function cookieIsLocal(cookie) { return cookie?.name === "authjs.session-token" && typeof cookie.value === "string" &&
  cookie.value.length > 0 && cookie.domain === "127.0.0.1" && cookie.path === "/" && cookie.httpOnly === true &&
  cookie.secure === false && cookie.sameSite === "Lax"; }

export function validateCashReadonlyBinding({ baseUrl, plan, sessions }) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new CashBrowserStop("BASE_URL_INVALID"); }
  check(url.origin === LOCAL && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash,
    "LOCAL_READONLY_TARGET_REQUIRED");
  assertCashQaTarget(plan?.target);
  check(plan?.target.kind === "EXISTING_LOCAL" && plan?.mode === "USD", "LOCAL_USD_PLAN_REQUIRED");
  const profiles = sessions?.sessions;
  check(sessions?.origin === LOCAL && Array.isArray(profiles) && same(profiles.map((profile) => profile.role), ROLES),
    "READONLY_SESSION_SET_INVALID");
  const pair = validateCashBrowserBinding({ baseUrl, plan,
    sessions: { origin: sessions.origin, sessions: profiles.slice(0, 2) } });
  const worker = profiles[2];
  check(worker.userId === plan.users[0].id && plan.users[0].active === true && cookieIsLocal(worker.cookie),
    "WORKER_SESSION_INVALID");
  check(new Set(profiles.map((profile) => profile.cookie.value)).size === 3, "SESSION_COOKIE_DUPLICATE");
  return { origin: pair.origin, profiles: Object.fromEntries(profiles.map((profile) => [profile.role, profile])) };
}

/** @param {{origin:string,method:string,pathname:string,headers?:Record<string,string>,body?:string|null,role:string,
 * plan:Record<string,any>,actionIds:Record<string,string>,previewArmed?:boolean}} input */
export function validateCashReadonlyRequest({ origin, method, pathname, headers = {}, body = null, role, plan,
  actionIds, previewArmed = false }) {
  check(origin === LOCAL, "CROSS_ORIGIN_REQUEST_FORBIDDEN");
  if (headers["next-router-prefetch"] || headers.purpose === "prefetch") return { kind: "abort-prefetch" };
  if (method === "GET") {
    check(staticGet(pathname) || READ_PAGES.has(pathname), "GET_OUTSIDE_READONLY_ROUTES");
    return { kind: "continue" };
  }
  check(method === "POST" && READ_PAGES.has(pathname), "WRITE_ROUTE_FORBIDDEN");
  let args;
  try { args = JSON.parse(body ?? "null"); } catch { throw new CashBrowserStop("ACTION_ARGS_INVALID"); }
  const actionId = headers["next-action"];
  if (actionId === actionIds.getBellData) {
    check(Array.isArray(args) && args.length === 0, "BELL_ARGS_FORBIDDEN");
    return { kind: "bell" };
  }
  if (actionId === actionIds.previewCashPayout) {
    check(role === "manager" && pathname === "/advances" && previewArmed, "USD_PREVIEW_NOT_ARMED");
    validateCashPreview(plan, role, pathname, args, { kind: "usd50" });
    return { kind: "preview" };
  }
  throw new CashBrowserStop("POST_ACTION_FORBIDDEN");
}

export function validateObservedNavigation({ expectedPath, responseStatus, responsePath, finalPath }) {
  check(responseStatus === 200, "NAVIGATION_RESPONSE_FAILED");
  check(responsePath === expectedPath && finalPath === expectedPath,
    "AUTH_LANDING_PATH_MISMATCH");
  return expectedPath;
}

export function validateReadonlyRedirect({ status, location, requestedUrl, expectedPath, contentType = "", body = "", forbiddenValues = [] }) {
  check([302, 303, 307, 308].includes(status) && typeof location === "string", "AUTH_REDIRECT_NOT_RETURNED");
  const request = new URL(requestedUrl);
  check(request.origin === LOCAL && ((request.pathname === "/finance/payroll" && expectedPath === "/") ||
    (request.pathname === "/finance/payroll/export" && request.search === "?month=2026-09" && expectedPath === "/") ||
    (request.pathname === "/advances" && expectedPath === "/")), "REDIRECT_REQUEST_TARGET_INVALID");
  let target;
  try { target = new URL(location, requestedUrl); } catch { throw new CashBrowserStop("AUTH_REDIRECT_LOCATION_INVALID"); }
  check(AUTH_REDIRECT_ORIGINS.has(target.origin) && target.pathname === expectedPath && !target.username && !target.password &&
    !target.search && !target.hash, "AUTH_REDIRECT_LOCATION_INVALID");
  check(!/csv|spreadsheet|ms-excel/i.test(contentType), "UNAUTHORIZED_EXPORT_CONTENT_TYPE");
  check(!/text\/csv|QA-CASH|\b200\s+BYN\b|\b300\s+BYN\b/i.test(body) &&
    forbiddenValues.every((value) => !value || !body.includes(value)), "UNAUTHORIZED_PAYROLL_BODY");
  return { status, locationOrigin: target.origin, locationPath: target.pathname };
}

export function validateReadonlySession(session, profile) {
  check(session?.user?.id === profile.userId && Array.isArray(session.user.roles), "AUTH_SESSION_IDENTITY_MISMATCH");
  const allowed = profile.role === "manager" ? ["MANAGER"] : profile.role === "finance"
    ? ["ADMIN", "DIRECTOR", "ACCOUNTANT"] : ["WORKER", "MOUNTER"];
  check(allowed.some((role) => session.user.roles.includes(role)), "AUTH_SESSION_ROLE_MISMATCH");
  return true;
}

function privateDirectory(path) {
  check(typeof path === "string" && existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(),
    "PRIVATE_OUTPUT_REQUIRED");
  const directory = realpathSync(path), temp = realpathSync(tmpdir());
  check(dirname(directory).toLowerCase() === temp.toLowerCase() && basename(directory).startsWith("pero-cash-qa-local-"),
    "PRIVATE_OUTPUT_FORBIDDEN");
  for (const file of ["cash-readonly-started.json", "cash-readonly-journal.jsonl", "cash-readonly-result.json",
    "cash-readonly-drained.json", "cash-readonly-stop.json"]) {
    check(!existsSync(join(directory, file)) && !existsSync(join(directory, `${file}.sha.json`)), "READONLY_RUN_ALREADY_ATTEMPTED");
  }
  return directory;
}

function saveExclusive(file, value) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "DURABLE_READBACK_FAILED");
  const proof = Buffer.from(JSON.stringify({ sha256: sha(bytes) }) + "\n"), proofFd = openSync(`${file}.sha.json`, "wx", 0o600);
  try { writeFileSync(proofFd, proof); fsyncSync(proofFd); } finally { closeSync(proofFd); }
}

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Checks role boundaries, the expected local FX error, and displayed existing payroll; sends no writes. */
export async function runCashReadonlyBrowser({ baseUrl, plan, sessions, serverReferenceManifest, outputDir,
  httpCredentials, externalGuard } = {}) {
  const binding = validateCashReadonlyBinding({ baseUrl, plan, sessions });
  const actionIds = cashActionIds(serverReferenceManifest), directory = privateDirectory(outputDir);
  check(!httpCredentials || (typeof httpCredentials.username === "string" && typeof httpCredentials.password === "string"),
    "HTTP_CREDENTIALS_INVALID");
  saveExclusive(join(directory, "cash-readonly-started.json"), { status: "STARTED", runId: plan.runId,
    target: plan.target.kind, roles: ROLES, manifestSha256: sha(JSON.stringify(serverReferenceManifest)) });
  const journalFd = openSync(join(directory, "cash-readonly-journal.jsonl"), "wx", 0o600);
  const journal = (row) => { appendFileSync(journalFd, JSON.stringify(row) + "\n"); fsyncSync(journalFd); };
  const handlers = new Set(), contexts = [];
  let draining = false, failure = null, managerPreviewArmed = false, previewRejected = false;
  let phase = "browser-setup", failureDiagnostics = null;
  const deniedPaths = {};

  async function attachRole(role, viewport) {
    const profile = binding.profiles[role];
    const context = await browser.newContext({ viewport, httpCredentials, serviceWorkers: "block" });
    contexts.push(context);
    await context.addCookies([profile.cookie]);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const pending = (async () => {
        try {
          check(!draining, "BROWSER_DRAINING");
          externalGuard?.();
          const url = new URL(request.url());
          const decision = validateCashReadonlyRequest({ origin: url.origin, method: request.method(), pathname: url.pathname,
            headers: request.headers(), body: request.postData(), role, plan, actionIds,
            previewArmed: managerPreviewArmed });
          if (decision.kind === "abort-prefetch") { await route.abort("blockedbyclient"); return; }
          if (decision.kind === "continue") { await route.continue(); return; }
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
          const bytes = await response.body();
          check(response.status() === 200, decision.kind === "preview" ? "USD_PREVIEW_HTTP_FAILED" : "BELL_HTTP_FAILED");
          if (decision.kind === "preview") {
            managerPreviewArmed = false;
            const outcome = cashActionOutcome(bytes);
            check(outcome.ok === false, "USD_PREVIEW_DID_NOT_RETURN_EXPECTED_ERROR");
            previewRejected = true;
          }
          journal({ event: decision.kind, role, path: url.pathname, status: response.status(), responseSha256: sha(bytes) });
          await route.fulfill({ response, body: bytes });
        } catch (error) {
          const code = error instanceof CashBrowserStop ? error.code : "READONLY_ROUTE_FAILED";
          failure ??= code;
          failureDiagnostics ??= { ...readonlyErrorDiagnostic(phase, error, code), role };
          journal({ event: "blocked-or-failed", phase, role, path: request.url().split("?")[0], method: request.method(),
            errorClass: errorClass(error), code });
          await route.abort("blockedbyclient").catch(() => {});
        }
      })();
      handlers.add(pending);
      try { await pending; } finally { handlers.delete(pending); }
    });
    return { context, page: await context.newPage() };
  }

  async function settleRequests() {
    while (handlers.size) await Promise.allSettled([...handlers]);
    if (failure) throw new CashBrowserStop(failure);
  }

  async function observeNavigation(page, requestedPath, expectedPath) {
    const response = await page.goto(`${LOCAL}${requestedPath}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await settleRequests();
    return validateObservedNavigation({ expectedPath, responseStatus: response?.status(),
      responsePath: response ? new URL(response.url()).pathname : null, finalPath: new URL(page.url()).pathname });
  }

  async function verifySession(context, profile) {
    externalGuard?.();
    const response = await context.request.get(`${LOCAL}/api/auth/session`, { maxRedirects: 0, failOnStatusCode: false, timeout: 20000 });
    check(response.status() === 200, "AUTH_SESSION_REQUEST_FAILED");
    let session;
    try { session = await response.json(); } catch { throw new CashBrowserStop("AUTH_SESSION_JSON_INVALID"); }
    return validateReadonlySession(session, profile);
  }

  async function probeDenied(context, profile, path, expectedPath) {
    const requestedUrl = `${LOCAL}${path}`;
    externalGuard?.();
    const response = await context.request.get(requestedUrl, { maxRedirects: 0, failOnStatusCode: false, timeout: 20000 });
    const location = response.headers().location ?? "";
    const contentType = response.headers()["content-type"] ?? "";
    const body = await response.text();
    const result = validateReadonlyRedirect({ status: response.status(), location, requestedUrl, expectedPath, contentType, body,
      forbiddenValues: [plan.users[1].name, plan.accounts[0].name] });
    journal({ event: "auth-denied", role: profile.role, path, status: result.status,
      locationOrigin: result.locationOrigin, locationPath: result.locationPath });
    return result;
  }

  let browser;
  try {
    phase = "browser-launch";
    browser = await chromium.launch({ headless: true });
    phase = "manager-advances-open";
    const manager = await attachRole("manager", VIEWPORTS[0]);
    await verifySession(manager.context, binding.profiles.manager);
    await observeNavigation(manager.page, "/advances", "/advances");
    check(new URL(manager.page.url()).pathname === "/advances" &&
      await manager.page.getByRole("heading", { name: "Выдача аванса" }).count() === 1, "MANAGER_ADVANCES_NOT_AVAILABLE");
    phase = "empty-required-form";
    const previewButton = manager.page.getByRole("button", { name: "Рассчитать и проверить сумму" });
    check(await previewButton.isDisabled(), "EMPTY_REQUIRED_FORM_NOT_DISABLED");
    check(!(await manager.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "MANAGER_VIEWPORT_OVERFLOW");
    await manager.page.screenshot({ path: join(directory, "cash-readonly-manager-360-form.png"), fullPage: true });

    phase = "fill-usd-preview";
    await manager.page.getByRole("button", { name: "Выберите сотрудника…" }).click();
    await manager.page.getByPlaceholder("Поиск по ФИО и должности…").fill(plan.users[0].name);
    await manager.page.getByRole("button", { name: new RegExp(escapeRegex(plan.users[0].name)) }).last().click();
    await manager.page.getByRole("button", { name: "Выберите кассу…" }).click();
    await manager.page.getByPlaceholder("Поиск кассы…").fill(plan.accounts[1].name);
    await manager.page.getByRole("button", { name: new RegExp(escapeRegex(plan.accounts[1].name)) }).last().click();
    await manager.page.getByLabel("Сумма выдачи, USD *").fill("50.00");
    await manager.page.getByLabel("Описание работы *").fill(`QA-CASH ${plan.runId} readonly USD preview`);
    managerPreviewArmed = true;
    check(!(await previewButton.isDisabled()), "USD_PREVIEW_FORM_NOT_ENABLED");
    phase = "usd-preview-request";
    await previewButton.click();
    phase = "usd-preview-error-message";
    const previewAlert = manager.page.locator("p[role='alert']").filter({ hasText: /курс|расч[её]т/i });
    await previewAlert.waitFor({ state: "visible", timeout: 15000 });
    await settleRequests();
    const previewMessage = await previewAlert.innerText();
    check(previewRejected && /курс|расч[её]т/i.test(previewMessage), "USD_PREVIEW_ERROR_NOT_VISIBLE");
    check(!(await manager.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "MANAGER_VIEWPORT_OVERFLOW");
    await manager.page.screenshot({ path: join(directory, "cash-readonly-manager-360-preview-error.png"), fullPage: true });
    const screenshots = ["cash-readonly-manager-360-form.png", "cash-readonly-manager-360-preview-error.png"];
    for (const viewport of VIEWPORTS.slice(1)) {
      phase = `manager-preview-${viewport.width}`;
      await manager.page.setViewportSize(viewport);
      check(!(await manager.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "MANAGER_VIEWPORT_OVERFLOW");
      const name = `cash-readonly-manager-${viewport.width}-preview-error.png`;
      await manager.page.screenshot({ path: join(directory, name), fullPage: true });
      screenshots.push(name);
    }

    for (const [path, expectedPath] of [["/finance/payroll", "/"],
      ["/finance/payroll/export?month=2026-09", "/"]]) {
      phase = `manager-deny-${path.split("?")[0]}`;
      deniedPaths[path] = await probeDenied(manager.context, binding.profiles.manager, path, expectedPath);
    }

    const worker = await attachRole("worker", VIEWPORTS[0]);
    await verifySession(worker.context, binding.profiles.worker);
    phase = "worker-deny-advances";
    deniedPaths["/advances:worker"] = await probeDenied(worker.context, binding.profiles.worker, "/advances", "/");
    const workerPath = deniedPaths["/advances:worker"].locationPath;

    const finance = await attachRole("finance", VIEWPORTS[2]);
    await verifySession(finance.context, binding.profiles.finance);
    phase = "finance-payroll-readonly";
    await observeNavigation(finance.page, "/finance/payroll", "/finance/payroll", false);
    check(await finance.page.getByRole("heading", { name: "Зарплата" }).count() === 1, "FINANCE_PAYROLL_NOT_AVAILABLE");
    const employeeRows = finance.page.getByRole("row").filter({ hasText: plan.users[1].name });
    check(await employeeRows.count() >= 2, "QA_EMPLOYEE_PAYROLL_ROWS_MISSING");
    const dueRow = await employeeRows.nth(0).innerText();
    const payoutRow = await employeeRows.nth(1).innerText();
    check(dueRow.includes("300 BYN") || payoutRow.includes("300 BYN"), "QA_PRIOR_MONTH_DEBT_NOT_VISIBLE");
    check(dueRow.includes("200 BYN") || payoutRow.includes("200 BYN"), "QA_CURRENT_SALARY_PAYOUT_NOT_VISIBLE");
    check(!(await finance.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "FINANCE_VIEWPORT_OVERFLOW");
    await finance.page.screenshot({ path: join(directory, "cash-readonly-finance-1440-payroll.png"), fullPage: true });
    screenshots.push("cash-readonly-finance-1440-payroll.png");
    phase = "finance-payout-dialog-readonly";
    await finance.page.getByRole("button", { name: /Добавить выплату/ }).click();
    await finance.page.getByRole("dialog").getByText("Выплата зарплаты").waitFor({ timeout: 5000 });
    check(!(await finance.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "FINANCE_DIALOG_OVERFLOW");
    await finance.page.screenshot({ path: join(directory, "cash-readonly-finance-1440-payout-dialog.png"), fullPage: true });
    screenshots.push("cash-readonly-finance-1440-payout-dialog.png");

    phase = "result-write";
    check(!failure && previewRejected, "READONLY_BROWSER_CHECK_FAILED");
    const result = { status: "READONLY_BROWSER_PASS", runId: plan.runId, target: plan.target.kind,
      checks: { managerFinanceRedirected: true, workerAdvancesRedirected: true, financeDebt300ByNAndPayout200ByN: true,
        usdPreviewRejected: true, emptyRequiredFormDisabled: true }, deniedPaths, workerPath, screenshots,
      remaining: ["readonly-capture-review", "cleanup", "staging"] };
    saveExclusive(join(directory, "cash-readonly-result.json"), result);
    return result;
  } catch (error) {
    failure ??= error instanceof CashBrowserStop ? error.code : "READONLY_BROWSER_FAILED";
    failureDiagnostics ??= readonlyErrorDiagnostic(phase, error, failure);
    throw new CashBrowserStop(failure);
  } finally {
    draining = true;
    let actionsDrained = false, contextsClosed = false;
    try {
      while (handlers.size) await Promise.allSettled([...handlers]);
      actionsDrained = true;
      for (const context of contexts) await context.close();
      await browser?.close();
      contextsClosed = true;
    } catch { failure ??= "BROWSER_DRAIN_FAILED"; }
    try { fsyncSync(journalFd); } catch { failure ??= "JOURNAL_SYNC_FAILED"; }
    try { closeSync(journalFd); } catch { failure ??= "JOURNAL_CLOSE_FAILED"; }
    saveExclusive(join(directory, "cash-readonly-drained.json"), { runId: plan.runId,
      actionsDrained, contextsClosed, inFlight: handlers.size, failure, phase });
    if (failure && !existsSync(join(directory, "cash-readonly-stop.json"))) {
      saveExclusive(join(directory, "cash-readonly-stop.json"), { status: "STOP", runId: plan.runId,
        code: failure, diagnostic: failureDiagnostics ?? readonlyErrorDiagnostic(phase, new Error(), failure) });
    }
  }
}
