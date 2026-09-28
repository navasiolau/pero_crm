/**
 * Imported by the reviewed root runner; never auto-runs and never reads secrets.
 * session is the complete PREPARED result from staging-browser-session.mjs.
 * Its session.checkpoint remains unchanged and contains no JWT cookies.
 * basicAuth is supplied in memory. outputDir MUST be a fresh, ignored directory
 * under this worktree's .playwright-mcp/. No trace, HAR or storage state is saved.
 * Root MUST pass result/error.ownWrites with the ORIGINAL checkpoint to restore.
 * On every successful preference response own-writes.json is replaced atomically.
 * Preference POSTs are fetched upstream exactly once, captured durably, then
 * fulfilled with the same response/body Buffer. Other allowed traffic continues.
 * Optional viewportWidths selects only 360, 390 and/or 1440 (default: all three).
 * Session GET has at most one retry, only for a known network reset/timeout.
 */
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ORIGIN = "https://staging-crm.peromebel.by";
const REQUIRED_ROLES = ["manager", "engineer"];
const PREF_KEYS = ["projects.list", "products.list"];
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const expect = playwrightExpect.configure({ timeout: 20_000 });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

class AcceptanceFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireCheck(value, code) { if (!value) throw new AcceptanceFailure(code); }
function sameSet(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function routeUrl(route) {
  const url = new URL(route, ORIGIN);
  requireCheck(url.origin === ORIGIN && ["/", "/projects", "/products"].includes(url.pathname), "NAVIGATION_NOT_ALLOWLISTED");
  return url.href;
}
function preferenceArgs(request) {
  if (request.method() !== "POST" || !request.headers()["next-action"]) return null;
  try {
    const args = JSON.parse(request.postData() ?? "");
    return Array.isArray(args) && args.length === 3 && ["projects", "products"].includes(args[0]) &&
      typeof args[1] === "string" && (args[2] === null || typeof args[2] === "string") ? args : null;
  } catch { return null; }
}
function emptyAction(request) {
  if (request.method() !== "POST" || !request.headers()["next-action"]) return false;
  try { const args = JSON.parse(request.postData() ?? ""); return Array.isArray(args) && args.length === 0; }
  catch { return false; }
}
function allowedGet(pathname) {
  return ["/", "/projects", "/products", "/api/auth/session", "/favicon.ico", "/manifest.webmanifest", "/manifest.json"].includes(pathname) ||
    pathname.startsWith("/_next/") || /^\/(?:icon|apple-touch-icon|favicon)[^/]*\.(?:png|svg|ico)$/.test(pathname);
}

export async function runBrowserAcceptance({ session, basicAuth, outputDir, viewportWidths } = {}) {
  const checks = [];
  const screenshots = [];
  const own = new Map();
  const pending = new Set();
  const contexts = new Set();
  const closing = new WeakSet();
  const failures = [];
  const startedAt = Date.now();
  let phase = "INPUT_GUARD";
  let browser;
  let ownPath;
  let journalPath;
  let requestNumber = 0;
  let failureCode;
  let bellActionId;
  let sessionDeadline;
  let viewports = VIEWPORTS;

  const ownWrites = () => [...own.values()].map(({ userId, key, value }) => ({ userId, key, value }));
  function persistOwnWrites() {
    if (!ownPath) return;
    const temp = `${ownPath}.next`;
    writeFileSync(temp, JSON.stringify(ownWrites()), { encoding: "utf8", mode: 0o600 });
    renameSync(temp, ownPath);
  }
  function journal(event) {
    try { appendFileSync(journalPath, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { encoding: "utf8", mode: 0o600 }); }
    catch { failures.push("PRIVATE_JOURNAL_WRITE_FAILED"); }
  }
  async function drain(timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (pending.size) {
      const remaining = deadline - Date.now();
      requireCheck(remaining > 0, "PREFERENCE_DRAIN_TIMEOUT");
      let timer;
      try {
        await Promise.race([
          Promise.allSettled([...pending]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new AcceptanceFailure("PREFERENCE_DRAIN_TIMEOUT")), remaining); }),
        ]);
      } finally { clearTimeout(timer); }
    }
  }
  function privateErrorDetails(error) {
    let message = String(error?.message ?? "Unknown capture error");
    const secrets = [basicAuth?.username, basicAuth?.password];
    if (basicAuth?.username && basicAuth?.password) secrets.push(Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString("base64"));
    for (const profile of Object.values(session?.profiles ?? {})) for (const cookie of profile.cookies ?? []) secrets.push(cookie.value);
    for (const secret of secrets) if (typeof secret === "string" && secret) message = message.split(secret).join("[REDACTED]");
    message = message.replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, "$1[REDACTED]");
    return { name: String(error?.name ?? "Error").slice(0, 80), message: message.slice(0, 2000) };
  }
  function sessionErrorDetails(error) {
    // The first line only: never copy Playwright's call-log/header block.
    const firstLine = String(error?.message ?? "Unknown session error").split(/\r?\n/, 1)[0].split(/Call log:/i, 1)[0];
    const explicitCode = error?.code ?? error?.cause?.code;
    const code = typeof explicitCode === "string" && /^[A-Z][A-Z0-9_:]{1,79}$/.test(explicitCode)
      ? explicitCode : firstLine.match(/\b(?:ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_[A-Z_]+|ERR_[A-Z_]+)\b/)?.[0] ?? null;
    const sanitized = privateErrorDetails({ name: error?.name, message: firstLine });
    return { name: sanitized.name, code, firstLine: sanitized.message.slice(0, 500) };
  }
  function retryableSessionGet(error, detail) {
    if (error instanceof AcceptanceFailure) return false;
    const codes = new Set(["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ERR_CONNECTION_RESET", "ERR_TIMED_OUT"]);
    return codes.has(detail.code) || error?.name === "TimeoutError" ||
      /\bsocket hang up\b|\bTimeout \d+ms exceeded\b|\bRequest timed out\b/i.test(detail.firstLine);
  }
  function sessionJournal(event) {
    try { appendFileSync(resolve(outputDir, "session-diagnostics.jsonl"), JSON.stringify({ at: new Date().toISOString(), phase, ...event }) + "\n", { encoding: "utf8", mode: 0o600 }); }
    catch { failures.push("PRIVATE_SESSION_DIAGNOSTICS_WRITE_FAILED"); }
  }
  async function verifySession(context, profile) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let operation = "get";
      let status;
      let current;
      try {
        const response = await context.request.get(`${ORIGIN}/api/auth/session`, { maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
        status = response.status();
        requireCheck(status === 200, "PROFILE_SESSION_HTTP_FAILED");
        operation = "json";
        current = await response.json();
        operation = "validate";
        const currentUserId = typeof current?.user?.id === "string" ? current.user.id : null;
        sessionJournal({ event: "session-observed", attempt, status, currentUserId, nullSession: current === null, remainingSessionMs: sessionDeadline - Date.now() });
        requireCheck(current !== null, "PROFILE_SESSION_NULL");
        requireCheck(currentUserId === profile.id && Array.isArray(current?.user?.roles) && sameSet(new Set(current.user.roles), new Set(profile.roles)), "PROFILE_SESSION_MISMATCH");
        return;
      } catch (error) {
        const native = sessionErrorDetails(error);
        const retry = operation === "get" && attempt === 1 && retryableSessionGet(error, native);
        sessionJournal({ event: "session-failed", attempt, operation, status, currentUserId: typeof current?.user?.id === "string" ? current.user.id : null, nullSession: current === null, remainingSessionMs: sessionDeadline - Date.now(), native, retry });
        if (retry) continue;
        throw new AcceptanceFailure(error instanceof AcceptanceFailure ? error.code : operation === "get" ? "PROFILE_SESSION_GET_FAILED" : "PROFILE_SESSION_JSON_FAILED");
      }
    }
  }
  async function forwardPreference(route, profile, args) {
    const [section, query, expected] = args;
    const requestId = ++requestNumber;
    const key = `${section}.list`;
    let operation = "fetch";
    let responseMeta;
    journal({ event: "request", requestId, userId: profile.id, key, query, expected });
    try {
      // Never continue/fallback/retry this intercepted POST after this call.
      // APIResponse keeps the body independently of page navigation/Chromium CDP.
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
      operation = "body";
      const body = await response.body();
      responseMeta = { status: response.status(), bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), contentType: response.headers()["content-type"] ?? null };
      journal({ event: "response-received", requestId, ...responseMeta });
      requireCheck(response.status() === 200, "PREFERENCE_HTTP_FAILED");
      operation = "parse";
      const outcomes = [];
      for (const line of body.toString("utf8").split("\n")) {
        try {
          const value = JSON.parse(line.slice(line.indexOf(":") + 1));
          if (typeof value?.ok === "boolean" && (typeof value.value === "string" || value.value === null)) outcomes.push(value);
        } catch { /* Other Flight rows are not action results. */ }
      }
      requireCheck(outcomes.length === 1, "PREFERENCE_RESULT_NOT_CAPTURED");
      const outcome = outcomes[0];
      if (outcome.ok) {
        const value = JSON.parse(outcome.value);
        requireCheck(value?.version === 1 && typeof value.revision === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.revision) && typeof value.query === "string" && outcome.value === JSON.stringify({ version: 1, revision: value.revision, query: value.query }), "PREFERENCE_RESULT_MALFORMED");
        own.set(`${profile.id}/${key}`, { userId: profile.id, key, value: outcome.value });
        operation = "persist";
        // Actual successful response bytes, committed BEFORE the browser sees it.
        persistOwnWrites();
        journal({ event: "saved", requestId, userId: profile.id, key, value: outcome.value, queryMatches: value.query === query });
        // The CRM controller sends its canonical query. A mismatch is a failure,
        // but the actual owned revision above is retained for safe CAS cleanup.
        requireCheck(value.query === query, "PREFERENCE_QUERY_MISMATCH");
      } else journal({ event: "compare-and-swap-conflict", requestId });
      operation = "fulfill";
      // Do not rebuild JSON or invent a response: forward this same body Buffer.
      await route.fulfill({ response, body });
      journal({ event: "forwarded", requestId, sha256: responseMeta.sha256 });
    } catch (error) {
      const code = error instanceof AcceptanceFailure ? error.code : `PREFERENCE_${operation.toUpperCase()}_FAILED`;
      failures.push(code);
      journal({ event: "capture-failed", requestId, operation, code, response: responseMeta, detail: privateErrorDetails(error) });
      // Upstream may already have committed; never send the POST again.
      await route.abort("failed").catch(() => {});
    }
  }
  async function step(name, fn) {
    phase = name;
    requireCheck(Date.now() - startedAt < 12 * 60_000 && Date.now() < sessionDeadline - 30_000, "SIGNED_SESSION_WINDOW_EXCEEDED");
    requireCheck(failures.length === 0, failures[0]);
    const metrics = await fn();
    await drain();
    requireCheck(failures.length === 0, failures[0]);
    checks.push({ check: name, status: "PASS", ...(metrics ?? {}) });
  }
  async function screenshot(page, name) {
    const file = resolve(outputDir, `${name.replace(/[^a-z0-9-]/gi, "_")}.png`);
    await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
    screenshots.push({ check: phase, file, ...page.viewportSize() });
  }
  async function visit(page, route) { await page.goto(routeUrl(route), { waitUntil: "domcontentloaded" }); }
  async function noOverflow(page) {
    const physicalWidth = page.viewportSize().width;
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(physicalWidth + 1);
  }
  async function listReady(page, section) {
    await expect(page).toHaveURL((url) => url.origin === ORIGIN && url.pathname === `/${section}`);
    await expect(page.getByRole("button", { name: "Таблица", exact: true })).toBeVisible();
  }
  async function setView(page, view) {
    await page.getByRole("button", { name: view === "table" ? "Таблица" : "Канбан", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("view") === view);
    await expect(page.locator('[data-pending="true"]')).toHaveCount(0);
    await drain();
  }
  async function commitCurrentList(page) {
    const view = new URL(page.url()).searchParams.get("view") === "table" ? "table" : "kanban";
    await setView(page, view === "table" ? "kanban" : "table");
    await setView(page, view);
  }
  async function openFilters(page, mobile) {
    if (!mobile) return page;
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("heading", { name: "Фильтры", exact: true })).toBeVisible();
    return panel;
  }
  async function closeFilters(page, mobile) {
    if (!mobile) return;
    await page.getByRole("button", { name: "Показать результаты", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  async function menu(page, section, mobile) {
    const label = section === "projects" ? "Проекты" : "Изделия";
    if (mobile) await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    const scope = mobile ? page.getByRole("dialog") : page;
    const link = scope.getByRole("link", { name: label, exact: true });
    requireCheck(await link.getAttribute("href") === `/${section}`, "MENU_TARGET_MISMATCH");
    await link.click();
    await listReady(page, section);
    if (mobile) await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  async function managerList(page, section, viewport) {
    const mobile = viewport.width < 768;
    const other = section === "projects" ? "products" : "projects";
    const placeholder = section === "projects" ? "Номер, название, клиент…" : "Номер, название, проект, клиент…";
    const filter = section === "projects" ? "stage" : "status";
    const value = section === "projects" ? "IN_WORK" : "DESIGN";
    const label = section === "projects" ? "В работе" : "Проектирование";
    await visit(page, `/${section}?view=table&active=0`);
    await listReady(page, section);
    await commitCurrentList(page);
    if (mobile) {
      await expect(page.locator('[data-slot="mobile-list-card"]').first()).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
    } else {
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.locator('[data-slot="mobile-list-card"]').first()).toBeHidden();
    }
    await noOverflow(page);
    const fonts = await page.evaluate(() => ({ bodyFont: parseFloat(getComputedStyle(document.body).fontSize), roboto: getComputedStyle(document.body).fontFamily.toLowerCase().includes("roboto") }));
    requireCheck(fonts.bodyFont >= (mobile ? 22 : 20) && fonts.roboto, "TYPOGRAPHY_MISMATCH");
    await screenshot(page, `manager-${viewport.width}-${section}-list`);
    let panel = await openFilters(page, mobile);
    const input = panel.getByPlaceholder(placeholder);
    const inputMetrics = await input.evaluate((el) => ({ font: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height }));
    requireCheck(inputMetrics.font >= (mobile ? 18 : 16) && inputMetrics.height >= (mobile ? 48 : 32), "INPUT_SIZE_MISMATCH");
    const q = `staging qa ${section}`;
    await input.fill(q);
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === q);
    await panel.getByRole("combobox").first().click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get(filter) === value);
    await screenshot(page, `manager-${viewport.width}-${section}-filters`);
    await closeFilters(page, mobile);
    await setView(page, "kanban");
    await menu(page, other, mobile);
    await commitCurrentList(page);
    await menu(page, section, mobile);
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === q && url.searchParams.get(filter) === value && url.searchParams.get("view") === "kanban");
    panel = await openFilters(page, mobile);
    await expect(panel.getByPlaceholder(placeholder)).toHaveValue(q);
    await expect(panel.getByRole("combobox").first()).toContainText(label);
    await closeFilters(page, mobile);
    await commitCurrentList(page);
    await visit(page, `/${section}?view=table`);
    await listReady(page, section);
    await commitCurrentList(page);
    panel = await openFilters(page, mobile);
    await expect(panel.getByPlaceholder(placeholder)).toHaveValue("");
    await expect(panel.getByRole("combobox").first()).toContainText(section === "projects" ? "Все этапы" : "Все статусы");
    await panel.getByPlaceholder(placeholder).fill("staging reset draft");
    await panel.getByRole("button", { name: "Сбросить", exact: true }).click();
    await expect(panel.getByPlaceholder(placeholder)).toHaveValue("");
    await expect(page).toHaveURL((url) => url.searchParams.toString() === "view=kanban");
    await closeFilters(page, mobile);
    await commitCurrentList(page);
    await menu(page, other, mobile);
    await commitCurrentList(page);
    await menu(page, section, mobile);
    await expect(page).toHaveURL((url) => url.searchParams.toString() === "view=kanban");
    await commitCurrentList(page);
    await noOverflow(page);
    return { width: viewport.width, bodyFont: fonts.bodyFont, inputFont: inputMetrics.font, inputHeight: inputMetrics.height };
  }
  async function longProjectForm(page, viewport) {
    await visit(page, "/projects?view=table");
    await listReady(page, "projects");
    await commitCurrentList(page);
    await page.getByRole("button", { name: "Проект", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Новый проект", exact: true })).toBeVisible();
    await page.setViewportSize({ width: viewport.width, height: 420 });
    await dialog.getByLabel("Адрес", { exact: true }).fill("Проверка длинного адреса и прокрутки формы без сохранения");
    const create = dialog.getByRole("button", { name: "Создать проект", exact: true });
    await expect(create).toBeDisabled();
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeInViewport();
    await expect.poll(() => dialog.evaluate((el, viewport) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= viewport.width + 1 && r.top >= 0 && r.bottom <= viewport.height + 1 && el.scrollWidth <= el.clientWidth + 1;
    }, { width: viewport.width, height: 420 })).toBe(true);
    await noOverflow(page);
    await screenshot(page, `manager-${viewport.width}-form-short-footer`);
    await dialog.getByRole("heading").first().scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("heading").first()).toBeInViewport();
    await screenshot(page, `manager-${viewport.width}-form-short-top`);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize(viewport);
  }
  async function engineerAccess(page, viewport) {
    await visit(page, "/");
    await listReady(page, "products");
    await commitCurrentList(page);
    await visit(page, "/products?view=table&active=0&pageSize=100");
    await listReady(page, "products");
    await commitCurrentList(page);
    const seen = new Set();
    const expectedNumbers = new Set(session.expected.engineerProducts.map((item) => item.number));
    const pages = Math.max(1, Math.ceil(expectedNumbers.size / 100));
    for (let n = 0; n < pages; n++) {
      const rows = viewport.width < 768
        ? await page.locator('[data-slot="mobile-list-card"]').evaluateAll((cards) => cards.map((card) => ({ number: decodeURIComponent(new URL(card.querySelector('a[href^="/products/"]').href).pathname.slice("/products/".length)), design: [...card.querySelectorAll('[data-slot="badge"]')].some((badge) => badge.textContent.trim() === "Проектирование") })))
        : await page.getByRole("table").locator("tbody tr").evaluateAll((rows) => rows.map((row) => ({ number: row.querySelector("td")?.textContent.trim(), design: [...row.querySelectorAll('[data-slot="badge"]')].some((badge) => badge.textContent.trim() === "Проектирование") })));
      requireCheck(rows.length > 0 && rows.every((row) => row.design && expectedNumbers.has(row.number)), "ENGINEER_VISIBLE_PRODUCT_MISMATCH");
      rows.forEach((row) => seen.add(row.number));
      if (n < pages - 1) {
        await page.getByRole("button", { name: "Вперёд", exact: true }).click();
        await expect(page).toHaveURL((url) => url.searchParams.get("page") === String(n + 2));
      }
    }
    await expect(page.getByRole("button", { name: "Вперёд", exact: true })).toBeDisabled();
    requireCheck(sameSet(seen, expectedNumbers), "ENGINEER_PRODUCT_SET_MISMATCH");
    await noOverflow(page);
    await screenshot(page, `engineer-${viewport.width}-own-design`);
    return { width: viewport.width, visibleDesignProducts: seen.size };
  }
  async function profileContext(role, viewport, fn) {
    phase = `${role}-${viewport.width}-session`;
    const profile = session.profiles[role];
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768, ignoreHTTPSErrors: false, serviceWorkers: "block", httpCredentials: { username: basicAuth.username, password: basicAuth.password, origin: ORIGIN } });
    contexts.add(context);
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(45_000);
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const readable = ["GET", "HEAD"].includes(request.method()) && allowedGet(url.pathname);
        const pageAction = ["/", "/projects", "/products"].includes(url.pathname);
        let bellRead = false;
        if (url.origin === ORIGIN && pageAction && emptyAction(request)) {
          // Source-verified mount/poll of NotificationsBell.getBellData(), not a
          // blanket permission for [] actions. No selected UI step can issue
          // another zero-argument action; pin its first mounted ID for this run.
          bellActionId ??= request.headers()["next-action"];
          bellRead = request.headers()["next-action"] === bellActionId;
        }
        const preference = preferenceArgs(request);
        const action = pageAction && (preference || bellRead);
        if (url.origin !== ORIGIN || (!readable && !action) || ((closing.has(context) || failures.length > 0) && preference)) {
          if (preference) journal({ event: "request-blocked", userId: profile.id, key: `${preference[0]}.list`, query: preference[1], reason: closing.has(context) ? "closing" : failures.length ? "previous-failure" : "route-guard" });
          const prefetched = request.headers()["next-router-prefetch"] || request.headers()["purpose"] === "prefetch";
          if (!closing.has(context) && (url.origin !== ORIGIN || (request.isNavigationRequest() && !prefetched) || !["GET", "HEAD"].includes(request.method()))) failures.push("REQUEST_NOT_ALLOWLISTED");
          await route.abort("blockedbyclient");
          return;
        }
        if (preference) {
          const capture = forwardPreference(route, profile, preference);
          pending.add(capture);
          try { await capture; } finally { pending.delete(capture); }
          return;
        }
        await route.continue();
      } catch {
        if (!closing.has(context)) failures.push("REQUEST_ROUTING_FAILED");
      }
    });
    await context.addCookies(profile.cookies.map(({ name, value }) => ({ name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: "Lax" })));
    const page = await context.newPage();
    try {
      await verifySession(context, profile);
      await fn(page);
      await drain();
    } catch (error) {
      // Preserve visual evidence while the failing page still exists. Never
      // attach the original DOM, Playwright error, cookies or request headers.
      if (!page.isClosed()) {
        try { await screenshot(page, `${role}-${viewport.width}-failure`); }
        catch { failures.push("FAILURE_SCREENSHOT_FAILED"); }
      }
      throw error;
    } finally {
      closing.add(context);
      try { await drain(); } finally {
        await context.close();
        contexts.delete(context);
        await drain(10_000);
        persistOwnWrites();
      }
    }
  }

  try {
    if (viewportWidths !== undefined) {
      requireCheck(Array.isArray(viewportWidths) && viewportWidths.length > 0 && viewportWidths.length <= VIEWPORTS.length && new Set(viewportWidths).size === viewportWidths.length && viewportWidths.every((width) => VIEWPORTS.some((viewport) => viewport.width === width)), "VIEWPORT_WIDTHS_NOT_ALLOWLISTED");
      viewports = viewportWidths.map((width) => VIEWPORTS.find((viewport) => viewport.width === width));
    }
    requireCheck(session?.status === "PREPARED" && session.checkpoint?.version === 1 && typeof session.checkpoint.signature === "string", "SIGNED_CHECKPOINT_REQUIRED");
    requireCheck(typeof session.availability?.combined === "boolean" && session.availability.combined === session.checkpoint.availability?.combined, "PROFILE_AVAILABILITY_REQUIRED");
    const roles = [...REQUIRED_ROLES, ...(session.availability.combined ? ["combined"] : [])];
    requireCheck(session.availability.combined || session.profiles?.combined === undefined, "UNAVAILABLE_COMBINED_PROFILE_MUST_NOT_BE_SUBSTITUTED");
    sessionDeadline = Date.parse(session.sessionExpiresAt);
    requireCheck(Number.isFinite(sessionDeadline) && Date.now() < sessionDeadline - 60_000, "FRESH_SIGNED_SESSIONS_REQUIRED");
    requireCheck(typeof basicAuth?.username === "string" && typeof basicAuth?.password === "string" && basicAuth.password.length > 0, "IN_MEMORY_BASIC_AUTH_REQUIRED");
    const ids = new Set();
    for (const role of roles) {
      const profile = session.profiles?.[role];
      requireCheck(typeof profile?.id === "string" && Array.isArray(profile.roles) && Array.isArray(profile.cookies) && profile.cookies.length > 0, "PROFILE_REQUIRED");
      const signedProfile = session.checkpoint.profiles?.[role];
      requireCheck(signedProfile?.id === profile.id && sameSet(new Set(signedProfile.roles), new Set(profile.roles)), "SIGNED_PROFILE_IDENTITY_MISMATCH");
      requireCheck(profile.cookies.every((cookie) => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(cookie.name) && typeof cookie.value === "string" && cookie.value.length > 0), "SESSION_COOKIE_REQUIRED");
      ids.add(profile.id);
    }
    requireCheck(ids.size === roles.length && session.profiles.manager.roles.length === 1 && session.profiles.manager.roles[0] === "MANAGER" && session.profiles.engineer.roles.length === 1 && session.profiles.engineer.roles[0] === "ENGINEER", "PROFILE_ROLES_MISMATCH");
    if (session.availability.combined) requireCheck(session.profiles.combined.roles.includes("MANAGER") && session.profiles.combined.roles.includes("ENGINEER"), "COMBINED_ROLES_MISMATCH");
    const originals = session.originalPreferences ?? [];
    const signedOriginals = new Map((session.checkpoint.originalPreferences ?? []).map((row) => [`${row.userId}/${row.key}`, row.value]));
    const originalKeys = new Set(originals.map((row) => `${row.userId}/${row.key}`));
    requireCheck(originals.length === roles.length * 2 && originalKeys.size === roles.length * 2 && signedOriginals.size === originalKeys.size && [...ids].every((id) => PREF_KEYS.every((key) => originalKeys.has(`${id}/${key}`))) && originals.every((row) => signedOriginals.get(`${row.userId}/${row.key}`) === row.value), "PREFERENCE_CHECKPOINT_REQUIRED");
    requireCheck(Array.isArray(session.expected?.engineerProducts) && session.expected.engineerProducts.length > 0 && session.expected.engineerProducts.every((row) => row.status === "DESIGN" && row.engineerId === session.profiles.engineer.id && typeof row.number === "string"), "ENGINEER_EXPECTED_COHORT_REQUIRED");
    requireCheck(typeof outputDir === "string" && isAbsolute(outputDir), "PRIVATE_OUTPUT_DIRECTORY_REQUIRED");
    outputDir = resolve(outputDir);
    const inside = relative(resolve(ROOT, ".playwright-mcp"), outputDir);
    requireCheck(inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside), "OUTPUT_MUST_BE_GITIGNORED_PRIVATE_CHILD");
    const candidateOwnPath = resolve(outputDir, "own-writes.json");
    requireCheck(!existsSync(candidateOwnPath), "FRESH_OUTPUT_DIRECTORY_REQUIRED");
    mkdirSync(outputDir, { recursive: true });
    ownPath = candidateOwnPath;
    journalPath = resolve(outputDir, "preference-requests.jsonl");
    persistOwnWrites();
    if (!session.availability.combined) checks.push({ check: "combined-manager-dashboard", status: "NOT_AVAILABLE", reason: "No active MANAGER+ENGINEER account in staging; union behavior was verified locally. No substitute account or role mutation used." });
    browser = await chromium.launch({ headless: true });
    for (const viewport of viewports) {
      await profileContext("manager", viewport, async (page) => {
        for (const section of ["projects", "products"]) await step(`manager-${viewport.width}-${section}-mobile-and-persistence`, () => managerList(page, section, viewport));
        await step(`manager-${viewport.width}-short-project-form`, () => longProjectForm(page, viewport));
      });
      await profileContext("engineer", viewport, (page) => step(`engineer-${viewport.width}-landing-and-own-design`, () => engineerAccess(page, viewport)));
      if (session.availability.combined) await profileContext("combined", viewport, (page) => step(`combined-${viewport.width}-manager-dashboard`, async () => {
        await visit(page, "/");
        await expect(page).toHaveURL((url) => url.origin === ORIGIN && url.pathname === "/");
        await expect(page.getByRole("heading", { name: "Дашборд", exact: true })).toBeVisible();
        await expect(page.getByText("Проекты в работе", { exact: true })).toBeVisible();
        await noOverflow(page);
        await screenshot(page, `combined-${viewport.width}-dashboard`);
      }));
    }
    requireCheck(failures.length === 0, failures[0]);
  } catch (error) {
    failureCode = error instanceof AcceptanceFailure ? error.code : failures[0] ?? `CHECK_FAILED_${phase}`;
    checks.push({ check: phase, status: "FAIL", code: failureCode });
  } finally {
    for (const context of contexts) closing.add(context);
    try { await drain(); } catch { failureCode ??= "FINAL_PREFERENCE_DRAIN_FAILED"; }
    if (browser) {
      try { await browser.close(); } catch { failureCode ??= "BROWSER_CLOSE_FAILED"; }
    }
    try { await drain(10_000); } catch { failureCode ??= "POST_CLOSE_DRAIN_FAILED"; }
    try { persistOwnWrites(); } catch { failureCode ??= "OWN_WRITES_CHECKPOINT_FAILED"; }
    if (failures.length) failureCode ??= failures[0];
  }
  const result = { status: failureCode ? "FAIL" : "PASS", checks, screenshots, ownWrites: ownWrites() };
  if (failureCode) {
    // No original Playwright error/cause: it may contain URLs, page text or headers.
    const error = new Error(`Staging browser acceptance failed: ${failureCode}`);
    Object.assign(error, { code: failureCode, ...result, result });
    throw error;
  }
  return result;
}
