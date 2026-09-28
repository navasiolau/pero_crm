/** Root-invoked, import-side-effect-free UI QA. No DB, SSH or process control. */
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const LOCAL = "http://127.0.0.1:3106";
const STAGING = "https://staging-crm.peromebel.by";
const LOCAL_CONTAINER = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const STAGING_CONTAINER = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = ["manager", "e1", "e2", "worker"];
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const expect = playwrightExpect.configure({ timeout: 20_000 });
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const re = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const READ_ONLY_EXPORTS = Object.freeze({ getBellData: "/src/server/notifications/actions.ts",
  getTaskSplitOptions: "/src/server/tasks/share-actions.ts", fetchProductOptions: "/src/server/products/actions.ts" });

export class EngineeringBrowserStop extends Error {
  constructor(code) { super(code); this.name = "EngineeringBrowserStop"; this.code = code; }
}
function guard(ok, code) { if (!ok) throw new EngineeringBrowserStop(code); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function noSecrets(value) {
  if (Array.isArray(value)) return value.every(noSecrets);
  if (!record(value)) return true;
  return Object.entries(value).every(([key, child]) => !/passwordHash|password$|secret|token|cookie|datasourceUrl|dsn/i.test(key) && noSecrets(child));
}

export function validateEngineeringBrowserInput({ baseUrl, plan, sessions } = {}) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new EngineeringBrowserStop("BASE_URL_INVALID"); }
  guard(url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash, "BASE_URL_COMPONENTS_FORBIDDEN");
  guard([LOCAL, STAGING].includes(url.origin), "TARGET_NOT_ALLOWLISTED");
  // The public baseline contains table digests, including a table named ApiToken.
  // It carries no token values; inspect its values separately from credential fields.
  const { baseline, ...publicFields } = record(plan) ? plan : {};
  guard(record(plan) && noSecrets(publicFields) && (baseline === undefined ||
    (record(baseline) && Object.values(baseline).every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)))) &&
    plan.format === "pero-engineering-owned-qa/v1" && UUID.test(plan.runId ?? ""), "PUBLIC_PLAN_SECRET_OR_FORMAT_INVALID");
  const local = url.origin === LOCAL;
  guard(plan.target?.kind === (local ? "EXISTING_LOCAL" : "EXISTING_STAGING") &&
    plan.target.containerId === (local ? LOCAL_CONTAINER : STAGING_CONTAINER) &&
    (local ? plan.target.host === "127.0.0.1" && plan.target.port === 5433 && plan.target.database === "pero_crm" :
      plan.target.guest === "crm-staging" && plan.target.host === "db" && plan.target.port === 5432 && plan.target.database === "crm"),
    "TARGET_IDENTITY_MISMATCH");
  const ids = plan.ids;
  guard(record(ids) && Array.isArray(ids.legacyTasks) && ids.legacyTasks.length === 2 && Array.isArray(ids.users) && ids.users.length === 3 &&
    [ids.project, ids.product, ids.pool, ids.legacyWork, ...ids.legacyTasks, ...ids.users].every((id) => UUID.test(id ?? "")) &&
    new Set([ids.project, ids.product, ids.pool, ids.legacyWork, ...ids.legacyTasks, ...ids.users]).size === 9, "OWNED_IDS_INVALID");
  guard(plan.project?.number === `QA-ENG-${plan.runId}` && plan.product?.number?.startsWith(`${plan.project.number}-`) &&
    plan.newWorkTitle?.includes(plan.runId) && plan.newWorkQuantity === "10.30" &&
    plan.legacy?.tasks?.length === 2 && same(plan.legacy.tasks.map((task) => task.id), ids.legacyTasks) &&
    same(plan.legacy.tasks.map((task) => task.quantity), ["2.00", "3.00"]) &&
    same(plan.legacy.tasks.map((task) => task.status), ["DONE", "NEW"]), "QA_GRAPH_MARKER_MISMATCH");
  guard(Array.isArray(plan.users) && plan.users.length === 3 && same(plan.users.map((user) => user.id), ids.users) &&
    same(plan.users.map((user) => user.roles), [["ENGINEER"], ["ENGINEER"], ["WORKER"]]), "QA_USERS_MISMATCH");
  const profiles = Array.isArray(sessions) ? sessions : sessions?.sessions;
  guard(Array.isArray(profiles) && profiles.length === 4 && same(profiles.map((profile) => profile.role), ROLES) &&
    profiles[0].userId === plan.managerId && same(profiles.slice(1).map((profile) => profile.userId), ids.users) &&
    new Set(profiles.map((profile) => profile.userId)).size === 4, "SESSION_IDENTITY_MISMATCH");
  guard(!sessions?.origin || sessions.origin === url.origin, "SESSION_ORIGIN_MISMATCH");
  const values = new Set();
  for (const profile of profiles) {
    const cookie = profile.cookie;
    guard(cookie?.name === (local ? "authjs.session-token" : "__Secure-authjs.session-token") && typeof cookie.value === "string" && cookie.value.length > 0 &&
      cookie.domain === url.hostname && cookie.path === "/" && cookie.httpOnly === true && cookie.secure === !local && cookie.sameSite === "Lax" &&
      !values.has(cookie.value), "SESSION_COOKIE_SCOPE_OR_DUPLICATE");
    values.add(cookie.value);
    if (profile.companionCookie !== undefined) {
      const companion = profile.companionCookie;
      guard(!local && companion?.name === "authjs.session-token" && typeof companion.value === "string" && companion.value.length > 0 &&
        companion.domain === url.hostname && companion.path === "/" && companion.httpOnly === true && companion.secure === true &&
        companion.sameSite === "Lax" && !values.has(companion.value), "COMPANION_COOKIE_SCOPE_OR_DUPLICATE");
      values.add(companion.value);
    }
  }
  return { origin: url.origin, local, profiles: Object.fromEntries(profiles.map((profile) => [profile.role, profile])) };
}

export function engineeringActionOutcome(bytes) {
  const outcomes = [];
  for (const line of Buffer.from(bytes).toString("utf8").split("\n")) {
    const at = line.indexOf(":"); if (at < 1) continue;
    try { const value = JSON.parse(line.slice(at + 1)); if (record(value) && typeof value.ok === "boolean") outcomes.push(value); }
    catch { /* Other Flight records are not action results. */ }
  }
  guard(outcomes.length === 1, "ACTION_RESULT_MISSING_OR_AMBIGUOUS");
  return outcomes[0];
}

/** Resolve only audited read exports from the actual build's server-reference manifest. */
export function engineeringReadOnlyActionIds(manifest) {
  guard(record(manifest?.node), "SERVER_REFERENCE_MANIFEST_REQUIRED");
  const found = new Map();
  for (const [id, entry] of Object.entries(manifest.node)) {
    const suffix = READ_ONLY_EXPORTS[entry?.exportedName];
    if (!suffix) continue;
    guard(/^[0-9a-f]{42}$/i.test(id) && typeof entry.filename === "string" &&
      entry.filename.replaceAll("\\", "/").endsWith(suffix) && !found.has(id) &&
      ![...found.values()].includes(entry.exportedName), "READ_ONLY_MANIFEST_ENTRY_INVALID");
    found.set(id, entry.exportedName);
  }
  guard(found.size === Object.keys(READ_ONLY_EXPORTS).length, "READ_ONLY_MANIFEST_EXPORT_MISSING");
  return found;
}

function privateDirectory(outputDir, local) {
  guard(typeof outputDir === "string" && isAbsolute(outputDir) && existsSync(outputDir) && lstatSync(outputDir).isDirectory() &&
    !lstatSync(outputDir).isSymbolicLink(), "PRIVATE_OUTPUT_DIRECTORY_REQUIRED");
  const directory = realpathSync(outputDir), temp = realpathSync(tmpdir());
  guard(dirname(directory).toLowerCase() === temp.toLowerCase() && basename(directory).startsWith(`pero-engineering-qa-${local ? "local" : "staging"}-`),
    "PRIVATE_OUTPUT_DIRECTORY_FORBIDDEN");
  for (const name of ["engineering-browser-started.json", "engineering-browser-result.json", "engineering-browser-drained.json"])
    guard(!existsSync(join(directory, name)), "BROWSER_RUN_MUST_NOT_BE_RETRIED");
  return directory;
}

/** Each mutation is one durable intent; failure/uncertainty stops the run, never retries. */
export async function runEngineeringBrowser({ baseUrl, plan, sessions, outputDir, httpCredentials, serverReferenceManifest, externalGuard } = {}) {
  const binding = validateEngineeringBrowserInput({ baseUrl, plan, sessions });
  guard(binding.local || typeof externalGuard === "function", "STAGING_WINDOW_GUARD_REQUIRED");
  const directory = privateDirectory(outputDir, binding.local);
  guard(httpCredentials === undefined || (record(httpCredentials) && typeof httpCredentials.username === "string" && typeof httpCredentials.password === "string"), "HTTP_CREDENTIALS_INVALID");
  const manifest = serverReferenceManifest ?? (binding.local ? JSON.parse(readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"), "utf8")) : null);
  const readOnlyActions = engineeringReadOnlyActionIds(manifest);
  const secrets = [...Object.values(binding.profiles).flatMap((profile) => [profile.cookie.value, profile.companionCookie?.value]),
    httpCredentials?.username, httpCredentials?.password].filter(Boolean);
  const redact = (value) => secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), String(value ?? ""))
    .replace(/((?:authorization|cookie|set-cookie)["'\s]*[:=]\s*)[^\r\n]*/gi, "$1[REDACTED]");
  function durable(name, value) {
    const file = join(directory, name), bytes = JSON.stringify(value, null, 2) + "\n";
    const handle = openSync(file, "wx", 0o600);
    try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
    guard(hash(readFileSync(file)) === hash(bytes), "DURABLE_READBACK_FAILED");
  }
  function journal(value) {
    const handle = openSync(join(directory, "engineering-browser-journal.jsonl"), "a", 0o600);
    try { appendFileSync(handle, JSON.stringify(value) + "\n"); fsyncSync(handle); } finally { closeSync(handle); }
  }
  durable("engineering-browser-started.json", { runId: plan.runId, target: binding.local ? "EXISTING_LOCAL" : "EXISTING_STAGING", at: new Date().toISOString() });

  const pages = new Map(), contexts = new Set(), pending = new Set(), blocked = new WeakSet(), actionIds = new Map();
  const checks = [], screenshots = [], actions = [], captured = { newWorkId: null, newTaskId: null, splitTaskId: null, splitRequestId: null,
    closeRequestId: null, settlementId: null, closeReplay: "NOT_TESTED" };
  let browser, armed = null, failure = null, uncertainMutation = false, closeRequest = null, finalResult = null, thrown = null;
  const productPath = `/products/${encodeURIComponent(plan.product.number)}`;
  const allowedPage = (role, path) => path === productPath || path === "/my" || path === "/api/auth/session" ||
    (role !== "manager" && path === "/payroll");
  const staticGet = (path) => path.startsWith("/_next/") || path.startsWith("/icons/") ||
    ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest"].includes(path);
  function fail(code, cause) { if (!failure) failure = { code, detail: redact(cause?.message ?? cause).slice(0, 1000) }; }
  function checkLive() { externalGuard?.(); if (failure) throw new EngineeringBrowserStop(failure.code); }

  function validateAction(intent, role, args) {
    guard(intent && !intent.consumed && intent.role === role && Array.isArray(args), "UNARMED_OR_DUPLICATE_ACTION");
    const data = args[0], ids = plan.ids;
    if (intent.kind === "rate") guard(args.length === 1 && data?.productId === ids.product && data.ratePercent === intent.rate &&
      ["0", "5"].includes(intent.rate) && Array.isArray(data.workWeights) && data.workWeights.length === 0 &&
      data.expectedPoolRevision === intent.expectedRevision, "RATE_ACTION_MISMATCH");
    else if (intent.kind === "convert") guard(args.length === 1 && data?.productId === ids.product && data.workId === ids.legacyWork && data.poolId === ids.pool &&
      same(data.taskShares?.map(({ taskId, units }) => [taskId, units]), [[ids.legacyTasks[0], 800000], [ids.legacyTasks[1], 200000]]) &&
      data.poolWeights?.length === 1 && data.poolWeights[0].workId === ids.legacyWork && data.poolWeights[0].units === 1000000 &&
      Number.isSafeInteger(data.expectedPoolRevision) && data.expectedPoolRevision > 0 && UUID.test(data.requestId ?? ""), "CONVERSION_ACTION_MISMATCH");
    else if (intent.kind === "create") guard(args.length === 1 && data?.productId === ids.product && data.title === plan.newWorkTitle &&
      data.quantity === "10.30" && data.assigneeId === ids.users[0] && data.estimateMinutes === 60 && data.poolWeights?.length === 2 &&
      data.poolWeights.some((row) => row.workId === "__new__" && row.units === 600000) &&
      data.poolWeights.some((row) => row.workId === ids.legacyWork && row.units === 400000), "CREATE_ACTION_MISMATCH");
    else if (intent.kind === "split") guard(args.length === 1 && data?.taskId === captured.newTaskId && data.recipientId === ids.users[1] &&
      Number(data.percent) === 50 && data.expectedRevision === 0 && UUID.test(data.requestId ?? ""), "SPLIT_ACTION_MISMATCH");
    else if (intent.kind === "reassign") guard(args.length === 2 && args[0] === ids.legacyTasks[1] && data === ids.legacyTasks[1] &&
      args[1]?.assigneeId === ids.users[2] && args[1]?.workId === ids.legacyWork && args[1]?.productId === ids.product &&
      args[1]?.title === plan.legacy.tasks[1].title && Number(args[1]?.quantity) === 3, "REASSIGN_ACTION_MISMATCH");
    else if (intent.kind === "price") guard(args.length === 2 && args[0] === ids.product && args[1]?.expectedPrice === 12000 &&
      args[1]?.title === plan.product.title && args[1]?.engineerId === ids.users[0], "PRICE_ACTION_MISMATCH");
    else if (intent.kind === "status") guard(args.length === 2 && args[0] === intent.taskId && args[1] === intent.toStatus &&
      [["e1", captured.newTaskId], ["e2", captured.splitTaskId], ["worker", ids.legacyTasks[1]]].some(([r, id]) => r === role && id === intent.taskId), "TASK_STATUS_ACTION_MISMATCH");
    else if (intent.kind === "close") guard(args.length === 1 && data?.productId === ids.product &&
      Number.isSafeInteger(data.expectedPoolRevision) && data.expectedPoolRevision > 0 && UUID.test(data.requestId ?? ""), "CLOSE_ACTION_MISMATCH");
    else if (intent.kind === "delivery") guard(args.length === 2 && args[0] === ids.product && args[1] === "DELIVERY", "DELIVERY_ACTION_MISMATCH");
    else throw new EngineeringBrowserStop("UNKNOWN_ACTION_INTENT");
    intent.consumed = true;
  }

  function validateReadOnly(name, role, args) {
    if (name === "getBellData") guard(args.length === 0, "BELL_READ_ARGS_INVALID");
    else if (name === "getTaskSplitOptions") guard(role === "e1" && same(args, [captured.newTaskId]) && captured.newTaskId,
      "SPLIT_OPTIONS_OUTSIDE_QA");
    else if (name === "fetchProductOptions") guard(role === "manager" && same(args, [plan.ids.project]), "PRODUCT_OPTIONS_OUTSIDE_QA");
    else throw new EngineeringBrowserStop("READ_ONLY_ACTION_UNKNOWN");
  }

  async function intercept(route, role) {
    const request = route.request();
    try {
      externalGuard?.();
      const url = new URL(request.url());
      guard(url.origin === binding.origin, "CROSS_ORIGIN_REQUEST_FORBIDDEN");
      if (request.method() === "GET") {
        if (request.headers()["next-router-prefetch"] || request.headers().purpose === "prefetch") { blocked.add(request); await route.abort("blockedbyclient"); return; }
        guard(staticGet(url.pathname) || allowedPage(role, url.pathname), "GET_OUTSIDE_QA_ROUTES");
        await route.continue(); return;
      }
      guard(request.method() === "POST" && request.headers()["next-action"] && allowedPage(role, url.pathname), "NON_ACTION_WRITE_FORBIDDEN");
      let args;
      try { args = JSON.parse(request.postData() ?? ""); } catch { throw new EngineeringBrowserStop("ACTION_BODY_NOT_PLAIN_JSON"); }
      guard(Array.isArray(args), "ACTION_ARGS_NOT_ARRAY");
      const actionId = request.headers()["next-action"];
      const readName = readOnlyActions.get(actionId);
      if (readName) {
        validateReadOnly(readName, role, args);
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
        const body = await response.body();
        guard(response.status() === 200, "READ_ONLY_ACTION_HTTP_FAILED");
        journal({ event: "read-only-action", name: readName, role, bodySha256: hash(request.postData() ?? ""), responseSha256: hash(body) });
        await route.fulfill({ response, body }); return;
      }
      if (args.length === 0) { blocked.add(request); await route.abort("blockedbyclient"); return; }
      const intent = armed;
      validateAction(intent, role, args);
      guard(actionId && actionId.length < 256 && (!actionIds.has(intent.kind) || actionIds.get(intent.kind) === actionId), "ACTION_ID_CHANGED");
      actionIds.set(intent.kind, actionId);
      journal({ event: "action-intent", kind: intent.kind, role, at: new Date().toISOString(), bodySha256: hash(request.postData() ?? "") });
      if (intent.kind === "close") {
        captured.closeRequestId = args[0].requestId;
        closeRequest = { url: request.url(), body: request.postData(), headers: Object.fromEntries(Object.entries(request.headers())
          .filter(([key]) => !/cookie|authorization|content-length|host|connection/i.test(key))) };
      }
      const count = ["close", "convert", "split"].includes(intent.kind) ? 2 : 1;
      const settled = await Promise.allSettled(Array.from({ length: count }, async () => {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
        const body = await response.body();
        guard(response.status() === 200, "ACTION_HTTP_NOT_200");
        return { response, body, outcome: engineeringActionOutcome(body) };
      }));
      if (settled.some((item) => item.status === "rejected")) { uncertainMutation = true; throw new EngineeringBrowserStop("ACTION_UPSTREAM_UNCERTAIN"); }
      const replies = settled.map((item) => item.value);
      guard(replies.every((item) => item.outcome.ok === true), "ACTION_REJECTED");
      if (intent.kind === "convert") guard(replies.every((item) => item.outcome.result?.receiptId &&
        item.outcome.result.receiptId === replies[0].outcome.result.receiptId), "CONVERSION_NOT_IDEMPOTENT");
      if (intent.kind === "split") guard(replies.every((item) => item.outcome.childTaskId &&
        item.outcome.childTaskId === replies[0].outcome.childTaskId), "SPLIT_NOT_IDEMPOTENT");
      if (intent.kind === "close") {
        const results = replies.map((item) => item.outcome.result);
        guard(results.every((result) => result?.settlementId && result.settlementId === results[0].settlementId), "CLOSE_NOT_IDEMPOTENT");
        captured.settlementId = results[0].settlementId;
      }
      if (intent.kind === "create") { captured.newWorkId = replies[0].outcome.result?.workId; captured.newTaskId = replies[0].outcome.result?.taskId;
        guard(typeof captured.newWorkId === "string" && typeof captured.newTaskId === "string", "CREATE_IDS_MISSING"); }
      if (intent.kind === "split") { captured.splitTaskId = replies[0].outcome.childTaskId; captured.splitRequestId = args[0].requestId;
        guard(typeof captured.splitTaskId === "string", "SPLIT_CHILD_MISSING"); }
      const number = actions.push({ kind: intent.kind, role, bodySha256: hash(request.postData() ?? ""), status: 200,
        responses: replies.map((item) => ({ bodySha256: hash(item.body), ok: item.outcome.ok, repeated: item.outcome.result?.repeated ?? null })) });
      journal({ event: "action-complete", number, kind: intent.kind, count, at: new Date().toISOString() });
      await route.fulfill({ response: replies[0].response, body: replies[0].body });
      intent.resolve(replies.map((item) => item.outcome));
    } catch (error) {
      fail(error instanceof EngineeringBrowserStop ? error.code : "INTERCEPT_FAILED", error);
      armed?.reject(error);
      await route.abort("failed").catch(() => {});
    }
  }

  async function act(role, kind, click, extra = {}) {
    checkLive(); guard(!armed, "ACTION_ALREADY_ARMED");
    let timer;
    const response = new Promise((resolve, reject) => {
      armed = { role, kind, ...extra, consumed: false, resolve, reject };
      timer = setTimeout(() => reject(new EngineeringBrowserStop("EXPECTED_ACTION_TIMEOUT")), 45_000);
    });
    void response.catch(() => {});
    try { await click(); return await response; }
    finally { clearTimeout(timer); armed = null; }
  }

  async function visit(role, path) {
    guard(allowedPage(role, path), "NAVIGATION_OUTSIDE_QA");
    const page = pages.get(role);
    const response = await page.goto(`${binding.origin}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    guard(response?.status() === 200 && new URL(page.url()).origin === binding.origin && new URL(page.url()).pathname === path, "PAGE_FAILED_OR_REDIRECTED");
    await page.waitForLoadState("load", { timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    const sw = await page.evaluate(() => ({ api: "serviceWorker" in navigator, serwist: typeof window.serwist }));
    guard(!sw.api && sw.serwist === "undefined" && page.context().serviceWorkers().length === 0, "SW_DISABLE_FAILED");
  }
  async function capture(role, phase, locator) {
    const page = pages.get(role);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      if (locator) await locator.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      guard(overflow <= 1, "HORIZONTAL_OVERFLOW");
      const name = `${phase}-${viewport.width}.png`, file = join(directory, name);
      guard(!existsSync(file), "SCREENSHOT_ALREADY_EXISTS");
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      screenshots.push({ phase, width: viewport.width, file: name, sha256: hash(readFileSync(file)) });
    }
  }
  async function productTab() { await visit("manager", productPath); const page = pages.get("manager"); await page.getByRole("tab", { name: "Инженерный фонд" }).click();
    await expect(page.getByRole("region", { name: "Инженерный фонд" })).toBeVisible(); return page; }
  async function myCard(role, title) {
    await visit(role, "/my");
    const page = pages.get(role);
    const card = page.locator('[data-slot="card"]').filter({ hasText: title }).filter({ has: page.getByRole("button", { name: /В работу|Выполнено|Разделить/ }) }).first();
    await expect(card).toBeVisible(); return card;
  }
  async function finishTask(role, taskId, title) {
    let card = await myCard(role, title);
    await act(role, "status", () => card.getByRole("button", { name: "В работу" }).click(), { taskId, toStatus: "IN_PROGRESS" });
    card = await myCard(role, title);
    await expect(pages.get(role).getByText(`Идёт таймер: ${title}`)).toBeVisible();
    await act(role, "status", () => card.getByRole("button", { name: "Выполнено" }).click(), { taskId, toStatus: "DONE" });
  }

  let drained = false;
  try {
    browser = await chromium.launch({ headless: true });
    for (const role of ROLES) {
      const profile = binding.profiles[role];
      const context = await browser.newContext({ baseURL: binding.origin, viewport: VIEWPORTS[0], deviceScaleFactor: 1,
        hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow", ignoreHTTPSErrors: false, serviceWorkers: "allow",
        ...(httpCredentials ? { httpCredentials } : {}) });
      contexts.add(context); await context.addCookies([profile.cookie, ...(profile.companionCookie ? [profile.companionCookie] : [])]);
      await context.addInitScript(() => { let owner = navigator; while (owner) { const descriptor = Object.getOwnPropertyDescriptor(owner, "serviceWorker");
        if (descriptor) { if (!descriptor.configurable || !Reflect.deleteProperty(owner, "serviceWorker")) throw new Error("SW_DISABLE_FAILED"); break; }
        owner = Object.getPrototypeOf(owner); } if ("serviceWorker" in navigator) throw new Error("SW_DISABLE_FAILED"); });
      await context.route("**/*", (route) => { const work = intercept(route, role); pending.add(work); void work.finally(() => pending.delete(work)).catch(() => {}); });
      const page = await context.newPage(); page.setDefaultTimeout(20_000); pages.set(role, page);
      page.on("pageerror", (error) => fail("PAGE_ERROR", error));
      page.on("requestfailed", (request) => { if (!blocked.has(request)) journal({ event: "request-failed", role, path: new URL(request.url()).pathname,
        reason: redact(request.failure()?.errorText).slice(0, 200) }); });
      const response = await context.request.get(`${binding.origin}/api/auth/session`, { timeout: 20_000, maxRetries: 0, maxRedirects: 0 });
      guard(response.status() === 200, "SESSION_HTTP_FAILED");
      const session = await response.json();
      guard(session?.user?.id === profile.userId && Array.isArray(session.user.roles) &&
        (role === "manager" ? session.user.roles.some((item) => ["MANAGER", "DIRECTOR", "ADMIN"].includes(item)) :
          same(session.user.roles, role === "worker" ? ["WORKER"] : ["ENGINEER"])), "SESSION_IDENTITY_MISMATCH");
    }

    let manager = await productTab();
    const fund = manager.getByRole("region", { name: "Инженерный фонд" });
    await expect(fund.getByText("Ставка не задана").first()).toBeVisible();
    await capture("manager", "null", fund); checks.push("null-view");
    await fund.locator("#engineering-rate").fill("101");
    await fund.getByRole("button", { name: "Сохранить ставку и веса" }).click();
    await expect(fund.getByRole("alert")).toContainText("от 0 до 100");
    await capture("manager", "rate-error", fund); checks.push("invalid-rate-visible-error-no-write");
    await fund.locator("#engineering-rate").fill("0");
    await act("manager", "rate", () => fund.getByRole("button", { name: "Сохранить ставку и веса" }).click(), { rate: "0", expectedRevision: 0 });
    manager = await productTab();
    const zero = manager.getByRole("region", { name: "Инженерный фонд" });
    await expect(zero.getByText(/^Ставка: 0(?:\.00)?%$/)).toBeVisible();
    await capture("manager", "zero", zero); checks.push("explicit-zero-rate-distinct-from-unset");
    await zero.locator("#engineering-rate").fill("5");
    await act("manager", "rate", () => zero.getByRole("button", { name: "Сохранить ставку и веса" }).click(), { rate: "5", expectedRevision: 1 });
    manager = await productTab();
    const draft = manager.getByRole("region", { name: "Инженерный фонд" });
    await expect(draft.getByText("5%").first()).toBeVisible();
    await draft.getByRole("group", { name: "Работа для перевода" }).getByRole("button").click();
    await manager.getByRole("button", { name: new RegExp(re(plan.legacy.title)) }).first().click();
    await draft.locator("#engineering-conversion-weight").fill("100");
    await draft.locator(`#engineering-convert-task-${plan.ids.legacyTasks[0]}`).fill("80");
    await draft.locator(`#engineering-convert-task-${plan.ids.legacyTasks[1]}`).fill("20");
    await act("manager", "convert", () => draft.getByRole("button", { name: "Перевести работу в инженерный фонд" }).click());
    manager = await productTab();
    const converted = manager.getByRole("region", { name: "Инженерный фонд" });
    await converted.locator(`#engineering-weight-${plan.ids.legacyWork}`).fill("40");
    await converted.locator("#engineering-new-title").fill(plan.newWorkTitle);
    await converted.locator("#engineering-new-quantity").fill("10.30");
    await converted.locator("#engineering-new-due").fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    await converted.locator("#engineering-new-estimate").fill("60");
    await converted.locator("#engineering-new-weight").fill("60");
    await act("manager", "create", () => converted.getByRole("button", { name: "Добавить инженерную работу" }).click());
    manager = await productTab();
    await expect(manager.getByRole("region", { name: "Инженерный фонд" }).getByText("≈ 500.00 BYN").first()).toBeVisible();
    await capture("manager", "draft", manager.getByRole("region", { name: "Инженерный фонд" })); checks.push("draft-view");

    let e1Card = await myCard("e1", plan.newWorkTitle);
    await e1Card.getByRole("button", { name: "Разделить" }).click();
    const split = pages.get("e1").getByRole("dialog", { name: "Разделить задачу" });
    await expect(split).toBeVisible();
    await split.getByRole("button", { name: "Выберите сотрудника" }).click();
    await pages.get("e1").getByRole("button", { name: new RegExp(re(plan.users[1].name)) }).first().click();
    await split.getByLabel("Передать от текущей доли, %").fill("50");
    await capture("e1", "split", split); checks.push("split-preview");
    await act("e1", "split", () => split.getByRole("button", { name: "Разделить задачу", exact: true }).click());
    await visit("e2", productPath);
    await expect(pages.get("e2").getByRole("heading", { name: new RegExp(re(plan.product.number)) })).toBeVisible();
    await expect(pages.get("e2").getByText("Проектирование", { exact: true }).first()).toBeVisible();
    await capture("e2", "e2-design-product", pages.get("e2").locator("main").last());
    checks.push("e2-design-product-membership-visible");
    manager = await productTab();
    await expect(manager.getByRole("region", { name: "Инженерный фонд" }).getByText("≈ 150.00 BYN").first()).toBeVisible();
    const splitPreview = manager.getByRole("region", { name: "Инженерный фонд" });
    await expect(splitPreview.getByText("≈ 160.00 BYN").first()).toBeVisible();
    await expect(splitPreview.getByText("≈ 40.00 BYN").first()).toBeVisible();
    guard(await splitPreview.getByText("≈ 150.00 BYN").count() >= 2, "SPLIT_PREVIEW_SHARES_MISSING");
    checks.push("preview-350-150-inferred-from-task-amounts");

    await manager.getByRole("tab", { name: /Работы и задачи/ }).click();
    const legacyCard = manager.locator('[data-slot="card"]').filter({ hasText: plan.legacy.tasks[1].title }).first();
    await legacyCard.click();
    const taskDialog = manager.getByRole("dialog", { name: plan.legacy.tasks[1].title });
    await taskDialog.getByRole("button", { name: "Редактировать" }).click();
    const taskEditor = manager.getByRole("dialog", { name: /Редактирование задачи/ });
    await taskEditor.getByText("Исполнитель", { exact: true }).locator("..").getByRole("button").click();
    await manager.getByRole("button", { name: new RegExp(re(plan.users[2].name)) }).first().click();
    await act("manager", "reassign", () => taskEditor.getByRole("button", { name: "Сохранить", exact: true }).click());
    manager = await productTab();
    await expect(manager.getByRole("region", { name: "Инженерный фонд" }).getByText("≈ 40.00 BYN").first()).toBeVisible();
    checks.push("preview-310-150-40-native-beneficiary-check-required");

    await manager.getByRole("button", { name: "Редактировать", exact: true }).first().click();
    const productDialog = manager.getByRole("dialog", { name: "Редактирование изделия" });
    await productDialog.locator("#ph-price").fill("12000");
    await act("manager", "price", () => productDialog.getByRole("button", { name: "Сохранить", exact: true }).click());
    manager = await productTab();
    await expect(manager.getByRole("region", { name: "Инженерный фонд" }).getByText("≈ 600.00 BYN").first()).toBeVisible();
    const priced = manager.getByRole("region", { name: "Инженерный фонд" });
    await expect(priced.getByText("≈ 192.00 BYN").first()).toBeVisible();
    await expect(priced.getByText("≈ 48.00 BYN").first()).toBeVisible();
    guard(await priced.getByText("≈ 180.00 BYN").count() >= 2, "PRICE_PREVIEW_SHARES_MISSING");
    checks.push("preview-372-180-48-inferred-from-task-amounts-native-beneficiary-check-required");

    await finishTask("e1", captured.newTaskId, plan.newWorkTitle);
    await finishTask("e2", captured.splitTaskId, plan.newWorkTitle);
    await finishTask("worker", plan.ids.legacyTasks[1], plan.legacy.tasks[1].title);
    for (const role of ["e1", "e2", "worker"]) { await visit(role, "/my"); await capture(role, `${role}-own`, pages.get(role).locator("main").last()); }
    manager = await productTab();
    const ready = manager.getByRole("region", { name: "Инженерный фонд" });
    await expect(ready.getByRole("button", { name: "Передать в производство и начислить фонд" })).toBeEnabled();
    await ready.getByRole("button", { name: "Передать в производство и начислить фонд" }).click();
    const closeDialog = manager.getByRole("dialog", { name: "Подтвердить передачу в производство" });
    await expect(closeDialog.getByText(/≈ 600.00 BYN/)).toBeVisible();
    await act("manager", "close", () => closeDialog.getByRole("button", { name: "Подтвердить и начислить" }).click());
    manager = await productTab();
    await expect(manager.getByRole("region", { name: "Инженерный фонд" }).getByText(/Начислено: 600(?:\.00)? BYN/)).toBeVisible();
    await capture("manager", "settled", manager.getByRole("region", { name: "Инженерный фонд" })); checks.push("settled-view");
    for (const role of ["e1", "e2", "worker"]) {
      await visit(role, "/payroll");
      const page = pages.get(role);
      await expect(page.locator("h1:not(header h1)").filter({ hasText: "Моя зарплата" })).toBeVisible();
      await expect(page.getByText("Инженерный фонд изделия").first()).toBeVisible();
      await capture(role, `${role}-payroll`, page.locator("main").last());
    }
    checks.push("e1-e2-worker-own-payroll-views");

    await act("manager", "delivery", async () => {
      await manager.getByRole("combobox", { name: "Сменить статус" }).click();
      await manager.getByRole("option", { name: "Доставка" }).click();
    });
    guard(closeRequest && captured.closeRequestId && captured.settlementId, "CLOSE_REPLAY_REQUEST_MISSING");
    checkLive();
    journal({ event: "close-replay-intent", at: new Date().toISOString(), requestId: captured.closeRequestId });
    const replay = await pages.get("manager").context().request.post(closeRequest.url, { headers: closeRequest.headers, data: closeRequest.body,
      maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
    guard(replay.status() === 200, "CLOSE_REPLAY_HTTP_FAILED");
    const replayResult = engineeringActionOutcome(await replay.body());
    guard(replayResult.ok === true && replayResult.result?.repeated === true && replayResult.result?.settlementId === captured.settlementId,
      "CLOSE_REPLAY_NOT_IDEMPOTENT");
    captured.closeReplay = "PASS";
    await visit("manager", productPath);
    await expect(pages.get("manager").getByText("Доставка", { exact: true }).first()).toBeVisible();
    checks.push("status-not-rewound-after-replay");
    for (const role of ["e1", "e2"]) {
      const page = pages.get(role);
      const denied = await page.goto(`${binding.origin}${productPath}`, { waitUntil: "load", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 });
      guard(denied?.status() === 404, "POST_DESIGN_PRODUCT_ACCESS_NOT_DENIED");
      await expect(page.locator("h1:not(header h1)").filter({ hasText: "404" })).toBeVisible();
      await expect(page.getByText(plan.product.title, { exact: true })).toHaveCount(0);
    }
    checks.push("primary-and-participant-product-denied-after-design");
    checkLive();
    finalResult = { status: "PASS", runId: plan.runId, target: binding.local ? "EXISTING_LOCAL" : "EXISTING_STAGING",
      checks, actions, screenshots, captured, nativeVerification: "ROOT_REQUIRED" };
  } catch (error) {
    thrown = error;
    fail(error instanceof EngineeringBrowserStop ? error.code : "BROWSER_SCENARIO_FAILED", error);
    finalResult = { status: "FAIL", runId: plan.runId, failure, checks, actions, screenshots, captured,
      nativeVerification: "ROOT_REQUIRED" };
  } finally {
    await Promise.allSettled([...pending]);
    let contextsClosed = true;
    for (const context of contexts) await context.close().catch(() => { contextsClosed = false; });
    if (browser) await browser.close().catch(() => { contextsClosed = false; });
    drained = pending.size === 0;
    if ((!drained || !contextsClosed || uncertainMutation) && finalResult.status === "PASS") {
      const code = uncertainMutation ? "MUTATION_UPSTREAM_UNCERTAIN" : "BROWSER_DRAIN_OR_CLOSE_FAILED";
      finalResult = { ...finalResult, status: "FAIL", failure: { code } };
      thrown = new EngineeringBrowserStop(code);
    }
    if (drained && contextsClosed) durable("engineering-browser-drained.json", { runId: plan.runId, actionsDrained: !uncertainMutation,
      contextsClosed, at: new Date().toISOString() });
    durable("engineering-browser-result.json", { ...finalResult, actionsDrained: drained && !uncertainMutation, contextsClosed });
  }
  if (thrown) throw thrown;
  return { ...finalResult, actionsDrained: drained && !uncertainMutation, contextsClosed: true };
}
