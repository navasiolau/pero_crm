/** Opt-in cash browser QA. Import opens no browser, connection or file. */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { assertCashQaTarget } from "./cash-owned-fixtures.mjs";

const LOCAL = "http://127.0.0.1:3106";
const STAGE = "https://staging-crm.peromebel.by";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const ACTION_SOURCES = Object.freeze({ previewCashPayout: "/src/server/payroll/cash-actions.ts",
  issueAdvance: "/src/server/payroll/cash-actions.ts", addPayout: "/src/server/payroll/actions.ts",
  deletePayout: "/src/server/payroll/actions.ts", getBellData: "/src/server/notifications/actions.ts" });
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];

export class CashBrowserStop extends Error { constructor(code) { super(code); this.name = "CashBrowserStop"; this.code = code; } }
function check(ok, code) { if (!ok) throw new CashBrowserStop(code); }

export function validateCashBrowserBinding({ baseUrl, plan, sessions }) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new CashBrowserStop("BASE_URL_INVALID"); }
  check(url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash &&
    [LOCAL, STAGE].includes(url.origin), "TARGET_NOT_ALLOWLISTED");
  assertCashQaTarget(plan?.target);
  check(plan?.format === "pero-cash-owned-qa/v1" && UUID.test(plan.runId ?? "") &&
    (url.origin === LOCAL ? plan.target.kind === "EXISTING_LOCAL" : plan.target.kind === "EXISTING_STAGING"),
  "TARGET_IDENTITY_MISMATCH");
  check(Array.isArray(plan.users) && plan.users.length === 2 && plan.users[0].active === true && plan.users[1].active === false &&
    plan.users.every((user) => user.name?.includes(plan.runId)) && Array.isArray(plan.accounts) && plan.accounts.length === 2 &&
    same(plan.accounts.map((account) => account.currency), ["BYN", "USD"]) &&
    Object.values(plan.requestIds ?? {}).length === 4 && Object.values(plan.requestIds).every((id) => UUID.test(id)) &&
    new Set(Object.values(plan.requestIds)).size === 4 && ["USD", "BYN_FALLBACK"].includes(plan.mode), "QA_PLAN_BINDING_INVALID");
  const profiles = sessions?.sessions;
  check(sessions?.origin === url.origin && Array.isArray(profiles) && profiles.length === 2 &&
    same(profiles.map((profile) => profile.role), ["manager", "finance"]) &&
    profiles[0].userId === plan.actors?.managerId && profiles[1].userId === plan.actors?.financeId,
  "SESSION_IDENTITY_MISMATCH");
  const names = new Set();
  for (const profile of profiles) {
    const cookie = profile.cookie;
    check(cookie?.name === (url.origin === LOCAL ? "authjs.session-token" : "__Secure-authjs.session-token") &&
      typeof cookie.value === "string" && cookie.value.length > 0 && !names.has(cookie.value) &&
      cookie.domain === url.hostname && cookie.path === "/" && cookie.httpOnly === true &&
      cookie.secure === (url.origin !== LOCAL) && cookie.sameSite === "Lax", "SESSION_COOKIE_SCOPE");
    names.add(cookie.value);
    if (url.origin === STAGE) {
      const companion = profile.companionCookie;
      check(companion?.name === "authjs.session-token" && typeof companion.value === "string" &&
        companion.value.length > 0 && companion.value !== cookie.value && !names.has(companion.value) &&
        companion.domain === url.hostname && companion.path === "/" && companion.httpOnly === true &&
        companion.secure === true && companion.sameSite === "Lax", "SESSION_COMPANION_COOKIE_SCOPE");
      names.add(companion.value);
    } else check(profile.companionCookie === undefined, "LOCAL_COMPANION_COOKIE_FORBIDDEN");
  }
  return { origin: url.origin, local: url.origin === LOCAL, profiles: Object.fromEntries(profiles.map((profile) => [profile.role, profile])) };
}

export function cashAuthCookies(profile, origin) {
  return origin === LOCAL ? [profile.cookie] : [profile.cookie, profile.companionCookie];
}

export function cashAuthCookieHeader(profile, origin) {
  return cashAuthCookies(profile, origin).map(({ name, value }) => `${name}=${value}`).join("; ");
}

export function cashManagerSessionMatches(session, expectedUserId) {
  return { idMatches: session?.user?.id === expectedUserId,
    hasManagerRole: Array.isArray(session?.user?.roles) && session.user.roles.includes("MANAGER") };
}

export function cashActionIds(manifest) {
  check(record(manifest?.node), "ACTION_MANIFEST_REQUIRED");
  /** @type {Record<string, string>} */
  const found = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    const expected = ACTION_SOURCES[entry?.exportedName];
    if (!expected) continue;
    const file = typeof entry.filename === "string" ? entry.filename.replaceAll("\\", "/") : "";
    check(/^[0-9a-f]{42}$/i.test(id) && (file.endsWith(expected) || file === expected.slice("/src/".length)) &&
      !found[entry.exportedName], "ACTION_MANIFEST_INVALID");
    found[entry.exportedName] = id;
  }
  check(Object.keys(found).length === Object.keys(ACTION_SOURCES).length, "ACTION_MANIFEST_MISSING");
  return found;
}

export function cashActionOutcome(bytes) {
  const outcomes = [];
  for (const line of Buffer.from(bytes).toString("utf8").split("\n")) {
    const at = line.indexOf(":"); if (at < 1) continue;
    try { const value = JSON.parse(line.slice(at + 1)); if (record(value) && typeof value.ok === "boolean") outcomes.push(value); }
    catch { /* Other Flight rows are not action results. */ }
  }
  check(outcomes.length === 1, "ACTION_RESULT_MISSING_OR_AMBIGUOUS");
  return outcomes[0];
}

/** All mutation payloads are exact reviewed QA values; only a generated UI UUID is replaced. */
export function pinCashActionIntent(plan, intent, args) {
  check(Array.isArray(args) && args.length === 1 && record(args[0]), "ACTION_ARGS_INVALID");
  const input = args[0];
  const cases = {
    advance120: { role: "manager", path: "/advances", userId: plan.users[0].id, accountId: plan.accounts[0].id,
      amount: "120.00", currency: "BYN", description: `QA-CASH ${plan.runId} advance`, requestId: plan.requestIds.advance },
    salary200: { role: "finance", path: "/finance/payroll", userId: plan.users[1].id, accountId: plan.accounts[0].id,
      amount: "200.00", currency: "BYN", description: `QA-CASH ${plan.runId} salary`, requestId: plan.requestIds.salary },
    usd50: { role: "manager", path: "/advances", userId: plan.users[0].id, accountId: plan.accounts[1].id,
      amount: "50.00", currency: "USD", description: `QA-CASH ${plan.runId} USD`, requestId: plan.requestIds.usd },
    delete10: { role: "manager", path: "/advances", userId: plan.users[0].id, accountId: plan.accounts[0].id,
      amount: "10.00", currency: "BYN", description: `QA-CASH ${plan.runId} delete`, requestId: plan.requestIds.delete },
  };
  const expected = cases[intent?.kind];
  check(expected && (intent.kind !== "usd50" || plan.mode === "USD") && intent.role === expected.role &&
    intent.path === expected.path, "ACTION_ROLE_OR_ROUTE_FORBIDDEN");
  const common = input.userId === expected.userId && input.cashAccountId === expected.accountId &&
    input.cashAmount === expected.amount && input.expectedCashCurrency === expected.currency && UUID.test(input.requestId ?? "");
  const salary = intent.kind === "salary200";
  check(common && (salary ? input.kind === "SALARY" && input.comment === expected.description &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(input.month ?? "") &&
    same(Object.keys(input).sort(), ["cashAccountId", "cashAmount", "comment", "expectedCashCurrency", "kind", "month", "requestId", "userId"])
    : input.description === expected.description &&
      same(Object.keys(input).sort(), ["cashAccountId", "cashAmount", "description", "expectedCashCurrency", "requestId", "userId"])),
  "ACTION_PAYLOAD_FORBIDDEN");
  return [{ ...input, requestId: expected.requestId }];
}

export function validateCashPreview(plan, role, path, args, intent) {
  check(["manager", "finance"].includes(role) && path === (role === "manager" ? "/advances" : "/finance/payroll") &&
    Array.isArray(args) && args.length === 1 && record(args[0]), "PREVIEW_ROUTE_INVALID");
  const expected = intent.kind === "usd50" ? [plan.accounts[1].id, "50.00", "USD"] :
    intent.kind === "salary200" ? [plan.accounts[0].id, "200.00", "BYN"] :
      intent.kind === "delete10" ? [plan.accounts[0].id, "10.00", "BYN"] : [plan.accounts[0].id, "120.00", "BYN"];
  check(same([args[0].cashAccountId, args[0].cashAmount, args[0].expectedCashCurrency], expected) &&
    same(Object.keys(args[0]).sort(), ["cashAccountId", "cashAmount", "expectedCashCurrency"]), "PREVIEW_PAYLOAD_FORBIDDEN");
  return args;
}

function privateOutputDirectory(path, local) {
  check(typeof path === "string" && isAbsolute(path) && existsSync(path) && lstatSync(path).isDirectory() &&
    !lstatSync(path).isSymbolicLink(), "PRIVATE_OUTPUT_REQUIRED");
  const directory = realpathSync(path), temp = realpathSync(tmpdir());
  check(dirname(directory).toLowerCase() === temp.toLowerCase() &&
    basename(directory).startsWith(`pero-cash-qa-${local ? "local" : "staging"}-`), "PRIVATE_OUTPUT_FORBIDDEN");
  for (const name of ["cash-browser-started.json", "cash-browser-journal.jsonl", "cash-browser-result.json", "cash-browser-drained.json"])
    check(!existsSync(join(directory, name)) && !existsSync(join(directory, `${name}.sha.json`)), "BROWSER_RUN_ALREADY_ATTEMPTED");
  return directory;
}

function saveExclusive(file, data) {
  const bytes = Buffer.from(JSON.stringify(data) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "DURABLE_READBACK_FAILED");
  const proof = Buffer.from(JSON.stringify({ sha256: sha(bytes) }) + "\n"), sf = openSync(`${file}.sha.json`, "wx", 0o600);
  try { writeFileSync(sf, proof); fsyncSync(sf); } finally { closeSync(sf); }
}

function regexp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function staticGet(path) { return path.startsWith("/_next/") || path.startsWith("/icons/") ||
  ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/sw.js"].includes(path); }

/** One actual form confirmation is required: route interception replaces only its generated request UUID. */
export async function runCashQaBrowser({ baseUrl, plan, sessions, serverReferenceManifest, outputDir, externalGuard, httpCredentials } = {}) {
  const binding = validateCashBrowserBinding({ baseUrl, plan, sessions });
  check(binding.local || typeof externalGuard === "function", "STAGING_WINDOW_GUARD_REQUIRED");
  const actionIds = cashActionIds(serverReferenceManifest), directory = privateOutputDirectory(outputDir, binding.local);
  check(!httpCredentials || (typeof httpCredentials.username === "string" && typeof httpCredentials.password === "string"),
    "HTTP_CREDENTIALS_INVALID");
  saveExclusive(join(directory, "cash-browser-started.json"), { status: "STARTED", runId: plan.runId,
    target: plan.target.kind, manifestSha256: sha(JSON.stringify(serverReferenceManifest)) });
  const fd = openSync(join(directory, "cash-browser-journal.jsonl"), "wx", 0o600);
  const journal = (value) => { appendFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); };
  let browser, context, armed = null, captured = null, failure = null, uncertain = false, mutationSent = false;
  let draining = false;
  const handlers = new Set();
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: VIEWPORTS[0], httpCredentials, serviceWorkers: "block" });
    await context.addCookies(cashAuthCookies(binding.profiles.manager, binding.origin));
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const pending = (async () => {
      const request = route.request(), url = new URL(request.url());
      try {
        check(!draining, "BROWSER_DRAINING");
        externalGuard?.();
        check(url.origin === binding.origin, "CROSS_ORIGIN_REQUEST_FORBIDDEN");
        if (request.method() === "GET") {
          if (request.headers()["next-router-prefetch"] || request.headers().purpose === "prefetch") { await route.abort(); return; }
          check(staticGet(url.pathname) || ["/advances", "/api/auth/session", "/payroll"].includes(url.pathname), "GET_OUTSIDE_QA_ROUTES");
          await route.continue(); return;
        }
        check(request.method() === "POST" && url.pathname === "/advances", "WRITE_ROUTE_FORBIDDEN");
        const actionId = request.headers()["next-action"];
        const args = JSON.parse(request.postData() ?? "null");
        if (actionId === actionIds.getBellData) {
          check(same(args, []), "BELL_ARGS_INVALID");
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
          await route.fulfill({ response }); return;
        }
        check(armed && !armed.consumed, "UNARMED_ACTION_FORBIDDEN");
        if (actionId === actionIds.previewCashPayout) {
          validateCashPreview(plan, "manager", url.pathname, args, armed);
          armed.preview = true;
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
          const body = await response.body();
          check(response.status() === 200 && cashActionOutcome(body).ok === true, "PREVIEW_FAILED");
          journal({ event: "preview", kind: armed.kind, requestSha256: sha(request.postData() ?? ""), responseSha256: sha(body) });
          await route.fulfill({ response, body }); return;
        }
        check(actionId === actionIds.issueAdvance && armed.kind === "advance120" && armed.preview, "FORM_ACTION_NOT_ARMED");
        const pinned = pinCashActionIntent(plan, { kind: armed.kind, role: "manager", path: url.pathname }, args);
        const bodyText = JSON.stringify(pinned);
        armed.consumed = true;
        journal({ event: "mutation-intent", kind: armed.kind, requestId: plan.requestIds.advance,
          requestSha256: sha(bodyText), at: new Date().toISOString() });
        mutationSent = true;
        const replies = await Promise.allSettled([0, 1].map(async () => {
          const response = await route.fetch({ postData: bodyText, maxRedirects: 0, maxRetries: 0, timeout: 30000 });
          const body = await response.body();
          check(response.status() === 200, "ACTION_HTTP_FAILED");
          return { response, body, result: cashActionOutcome(body) };
        }));
        if (replies.some((reply) => reply.status === "rejected")) { uncertain = true; throw new CashBrowserStop("ACTION_UPSTREAM_UNCERTAIN"); }
        const results = replies.map((reply) => reply.value);
        check(results.every((reply) => reply.result.ok && reply.result.payoutId === results[0].result.payoutId) &&
          results.filter((reply) => reply.result.repeated === true).length === 1, "DUPLICATE_NOT_IDEMPOTENT");
        captured = { requestId: plan.requestIds.advance, payoutId: results[0].result.payoutId,
          repeated: results.map((reply) => reply.result.repeated) };
        journal({ event: "mutation-result", kind: armed.kind, requestId: captured.requestId,
          payoutId: captured.payoutId, responseHashes: results.map((reply) => sha(reply.body)) });
        await route.fulfill({ response: results[0].response, body: results[0].body });
      } catch (error) {
        failure = error instanceof Error ? error.message : "BROWSER_ACTION_FAILED";
        if (mutationSent) uncertain = true;
        await route.abort("blockedbyclient").catch(() => {});
      }
      })();
      handlers.add(pending);
      void pending.finally(() => handlers.delete(pending));
      return pending;
    });
    externalGuard?.();
    const sessionResponse = await context.request.get(`${binding.origin}/api/auth/session`,
      { maxRedirects: 0, timeout: 30000 });
    const contentType = String(sessionResponse.headers()["content-type"] ?? "");
    let session = null;
    if (sessionResponse.status() === 200 && contentType.includes("json")) {
      try { session = await sessionResponse.json(); } catch { /* Reject malformed session below. */ }
    }
    const { idMatches, hasManagerRole } = cashManagerSessionMatches(session, plan.actors.managerId);
    externalGuard?.();
    check(sessionResponse.status() === 200 && idMatches && hasManagerRole, "MANAGER_SESSION_INVALID");
    journal({ event: "manager-session-verified", status: sessionResponse.status(), idMatches, hasManagerRole });
    await page.goto(`${binding.origin}/advances`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const advancesHeading = page.getByRole("heading", { name: "Выдача аванса" });
    await advancesHeading.waitFor({ state: "visible", timeout: 30000 });
    check((await advancesHeading.count()) === 1, "ADVANCES_PAGE_MISSING");
    await page.getByRole("button", { name: "Выберите сотрудника…" }).click();
    await page.getByPlaceholder("Поиск по ФИО и должности…").fill(plan.users[0].name);
    await page.getByRole("button", { name: new RegExp(regexp(plan.users[0].name)) }).last().click();
    await page.getByRole("button", { name: "Выберите кассу…" }).click();
    await page.getByPlaceholder("Поиск кассы…").fill(plan.accounts[0].name);
    await page.getByRole("button", { name: new RegExp(regexp(plan.accounts[0].name)) }).last().click();
    await page.getByLabel("Сумма выдачи, BYN *").fill("120.00");
    await page.getByLabel("Описание работы *").fill(`QA-CASH ${plan.runId} advance`);
    armed = { kind: "advance120", preview: false, consumed: false };
    await page.getByRole("button", { name: "Рассчитать и проверить сумму" }).click();
    await page.getByText("Предварительный расчёт").waitFor({ timeout: 30000 });
    check(!failure && armed.preview, "PREVIEW_NOT_OBSERVED");
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "HORIZONTAL_OVERFLOW");
    await page.screenshot({ path: join(directory, "advance-360-preview.png"), fullPage: true });
    await page.getByRole("button", { name: "Подтвердить и выдать аванс" }).click();
    await page.getByText("Аванс выдан").waitFor({ timeout: 30000 });
    check(!failure && captured?.payoutId, "FORM_CONFIRM_NOT_OBSERVED");
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "HORIZONTAL_OVERFLOW");
    await page.screenshot({ path: join(directory, "advance-360-receipt.png"), fullPage: true });
    for (const viewport of VIEWPORTS.slice(1)) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await advancesHeading.waitFor({ state: "visible", timeout: 30000 });
      check((await advancesHeading.count()) === 1, "ADVANCES_PAGE_MISSING");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check(!overflow, "HORIZONTAL_OVERFLOW");
      await page.screenshot({ path: join(directory, `advance-${viewport.width}.png`), fullPage: true });
    }
    saveExclusive(join(directory, "cash-browser-result.json"), { status: "FORM_ADVANCE_CREATED", runId: plan.runId,
      target: plan.target.kind, captured, screenshots: ["advance-360-preview.png", "advance-360-receipt.png", "advance-390.png", "advance-1440.png"],
      remaining: ["salary200", ...(plan.mode === "USD" ? ["usd50"] : []), "delete10", "final-capture-cleanup"] });
    return { status: "FORM_ADVANCE_CREATED", captured, screenshots: 4, remaining: true };
  } catch (error) {
    failure ??= error instanceof Error ? error.message : "BROWSER_FAILURE";
    if (mutationSent) uncertain = true;
    throw error;
  } finally {
    draining = true;
    let actionsDrained = false, contextsClosed = false;
    try {
      while (handlers.size) await Promise.allSettled([...handlers]);
      actionsDrained = true;
      await context?.close();
      await browser?.close();
      contextsClosed = true;
    } catch (error) {
      failure ??= error instanceof Error ? error.message : "BROWSER_DRAIN_FAILED";
      if (mutationSent) uncertain = true;
    }
    journal({ event: "drain", actionsDrained, contextsClosed, inFlight: handlers.size });
    closeSync(fd);
    saveExclusive(join(directory, "cash-browser-drained.json"), { runId: plan.runId, target: plan.target.kind,
      actionsDrained, contextsClosed, inFlight: handlers.size, uncertain });
    if (failure || uncertain) {
      const file = join(directory, "cash-browser-stop.json");
      if (!existsSync(file)) saveExclusive(file, { status: "STOP", code: /^[A-Z_]+$/.test(failure ?? "") ? failure : "BROWSER_FAILURE_INSPECT_JOURNAL",
        uncertain, requestId: uncertain ? plan.requestIds.advance : null });
    }
  }
}
