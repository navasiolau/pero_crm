/**
 * Root-invoked browser acceptance; importing this file has no side effects.
 * Input is PRIVATE, in memory: {baseUrl,outputDir,plan,sessions,httpCredentials?}.
 * plan is the minimal owned-fixture plan WITHOUT passwordHash/baseline/secrets.
 * sessions comes from executeOwnedQa(... operation:'sessions').
 *
 * Only http://localhost:3105, http://127.0.0.1:3105 and the exact HTTPS staging
 * origin are accepted. Root verifies native DB/container/image before invoking.
 * Root supplies an owner-private existing temp directory. No trace/HAR/cookies
 * or storageState are saved. Response diagnostics contain redacted bodies only.
 *
 * Exactly one UI create C and one UI split A are admitted. The captured split
 * POST is deliberately sent TWICE concurrently with the same real UUID; D DONE
 * is likewise deliberately duplicated once. These are fixed idempotency tests,
 * never retries of a failed write. Every upstream response is saved before the
 * browser receives one original, unchanged response/body Buffer.
 *
 * C id is observed from its own UI's readonly getTaskSplitOptions request and
 * verified against the 0.30/30 snapshot. D id and split UUID are captured from
 * the actual split request/response. Group id is NOT guessed: root's subsequent
 * capture proves it via the same immutable split receipt. No list preferences
 * are changed. Root must capture/inspect native timers/payroll before cleanup.
 *
 * browser-drained.json is created only after confirmed context/browser closure
 * and all intercepts have settled. actionsDrained stays FALSE if a mutation's
 * upstream completion is uncertain. A failed scenario is never auto-restarted.
 *
 * The isolated browser has no serviceWorker API. Playwright's "block" stub
 * returns no registration and breaks Serwist, so remove the configurable API
 * before application boot instead. Registration is never mocked; /sw.js stays
 * forbidden. Offline/PWA behavior is outside this acceptance.
 */
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCAL_ORIGINS = new Set(["http://localhost:3105", "http://127.0.0.1:3105"]);
const STAGING_ORIGIN = "https://staging-crm.peromebel.by";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 390, height: 844 }];
const expect = playwrightExpect.configure({ timeout: 20_000 });
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hash = (value) => createHash("sha256").update(value).digest("hex");

export class WorkSharesBrowserStop extends Error {
  constructor(code) { super(code); this.name = "WorkSharesBrowserStop"; this.code = code; }
}
const guard = (value, code) => { if (!value) throw new WorkSharesBrowserStop(code); };
const re = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const money = (amount, currency) => `${new Intl.NumberFormat("ru-RU").format(amount)} ${{ BYN: "BYN", RUB: "₽", USD: "$", EUR: "€" }[currency] ?? currency}`;

export function workSharesTimerSeconds(label) {
  if (typeof label !== "string") return null;
  // MyTasksView displays mm:ss, adding hours only once the timer reaches one hour.
  const match = /^Стоп\s+(?:(\d+):)?([0-5]\d):([0-5]\d)$/.exec(label.trim());
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function validateWorkSharesBrowserInput({ baseUrl, plan, sessions } = {}) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new WorkSharesBrowserStop("BASE_URL_INVALID"); }
  guard(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "BASE_URL_COMPONENTS_FORBIDDEN");
  guard(LOCAL_ORIGINS.has(url.origin) || url.origin === STAGING_ORIGIN, "TARGET_NOT_ALLOWLISTED");
  guard(record(plan) && UUID.test(plan.runId ?? ""), "OWNED_PLAN_REQUIRED");
  guard(Object.keys(plan).every((key) => ["runId", "project", "work", "source", "dependent", "users", "fractionalTitle", "taskType", "dueAt", "currency"].includes(key)), "PLAN_MUST_BE_MINIMAL_WITHOUT_SECRETS");
  guard(Array.isArray(plan.users) && plan.users.length === 2 && same(plan.users.map((user) => user.roles), [["WORKER"], ["MOUNTER"]]), "QA_ROLES_REQUIRED");
  const ids = [plan.project?.id, plan.work?.id, plan.source?.id, plan.dependent?.id, ...plan.users.map((user) => user.id)];
  guard(ids.every((id) => UUID.test(id ?? "")) && new Set(ids).size === 6, "OWNED_IDS_INVALID");
  guard(plan.project.number === `LOCAL-QA-${plan.runId}`, "PROJECT_MARKER_MISMATCH");
  for (const value of [plan.project.title, plan.work.title, plan.source.title, plan.dependent.title, plan.fractionalTitle, ...plan.users.map((user) => user.name)]) guard(typeof value === "string" && value.includes(plan.runId), "OWNED_NAME_MARKER_MISMATCH");
  guard(new Set([plan.source.title, plan.dependent.title, plan.fractionalTitle]).size === 3, "TASK_TITLES_MUST_BE_DISTINCT");
  guard(["BYN", "RUB", "USD", "EUR"].includes(plan.currency) && Number.isFinite(Date.parse(plan.dueAt)), "PLAN_MONEY_DATE_INVALID");
  for (const user of plan.users) guard(Object.keys(user).every((key) => ["id", "name", "roles"].includes(key)), "QA_USER_PAYLOAD_MUST_NOT_CONTAIN_CREDENTIALS");
  guard(Array.isArray(sessions) && sessions.length === 3 && new Set(sessions.map((item) => item.role)).size === 3, "THREE_ISOLATED_SESSIONS_REQUIRED");
  const profiles = Object.fromEntries(sessions.map((item) => [item.role, item]));
  guard(profiles.manager && profiles.worker && profiles.mounter && ID.test(profiles.manager.userId ?? ""), "SESSION_PROFILES_INVALID");
  guard(profiles.worker.userId === plan.users[0].id && profiles.mounter.userId === plan.users[1].id && new Set(sessions.map((item) => item.userId)).size === 3, "SESSION_IDENTITY_MISMATCH");
  for (const item of sessions) {
    const cookie = item.cookie;
    guard(cookie?.name === (url.protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token") && typeof cookie.value === "string" && cookie.value.length > 0, "SIGNED_SESSION_COOKIE_REQUIRED");
    guard(cookie.domain === url.hostname && cookie.path === "/" && cookie.httpOnly === true && cookie.secure === (url.protocol === "https:") && cookie.sameSite === "Lax", "SESSION_COOKIE_SCOPE_MISMATCH");
  }
  return { origin: url.origin, local: LOCAL_ORIGINS.has(url.origin), profiles };
}

/** Parse a real Flight action row; never invent a missing or ambiguous result. */
export function workSharesActionOutcome(bytes) {
  const outcomes = [];
  for (const line of Buffer.from(bytes).toString("utf8").split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    try {
      const value = JSON.parse(line.slice(colon + 1));
      if (record(value) && typeof value.ok === "boolean") outcomes.push(value);
    } catch { /* Non-JSON Flight records are not action results. */ }
  }
  guard(outcomes.length === 1, "ACTION_RESULT_MISSING_OR_AMBIGUOUS");
  return outcomes[0];
}

export function validateWorkSharesCompletionIds(plan, capturedIds) {
  guard(record(capturedIds) && same(Object.keys(capturedIds).sort(), ["child", "dependent", "fractional", "source", "splitRequestId"]), "COMPLETION_CAPTURED_IDS_REQUIRED");
  guard(capturedIds.source === plan.source.id && capturedIds.dependent === plan.dependent.id && UUID.test(capturedIds.splitRequestId), "COMPLETION_CAPTURED_IDS_MISMATCH");
  const tasks = [capturedIds.source, capturedIds.dependent, capturedIds.fractional, capturedIds.child];
  guard(tasks.every((id) => typeof id === "string" && ID.test(id)) && new Set(tasks).size === 4, "COMPLETION_TASK_IDS_INVALID");
  const otherIds = [plan.project.id, plan.work.id, ...plan.users.map((user) => user.id)];
  guard(tasks.every((id) => !otherIds.includes(id)), "COMPLETION_TASK_IDS_INVALID");
  return { ...capturedIds };
}

function privateDirectory(outputDir, local, prefix) {
  guard(typeof outputDir === "string" && isAbsolute(outputDir), "ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED");
  guard(existsSync(outputDir) && lstatSync(outputDir).isDirectory() && !lstatSync(outputDir).isSymbolicLink(), "EXISTING_PRIVATE_DIRECTORY_REQUIRED");
  const directory = realpathSync(outputDir);
  const temp = realpathSync(tmpdir());
  const inTemp = dirname(directory).toLowerCase() === temp.toLowerCase() && basename(directory).startsWith(`pero-work-shares-qa-${local ? "local" : "staging"}-`);
  const ignored = relative(resolve(ROOT, ".playwright-mcp"), directory);
  const inWorkspace = ignored && !ignored.startsWith("..") && !isAbsolute(ignored) && basename(directory).startsWith("work-shares-");
  guard(inTemp || inWorkspace, "PRIVATE_DIRECTORY_NOT_ALLOWLISTED");
  for (const suffix of ["started.json", "receipt.json", "drained.json", "error.json", "journal.jsonl"]) guard(!existsSync(join(directory, `${prefix}-${suffix}`)), "BROWSER_RUN_MUST_NOT_BE_RETRIED");
  return directory;
}

export async function runWorkSharesBrowser(input = {}) {
  return runWorkSharesBrowserScenario(input, false);
}

/** Finish only the two readonly assertions after root has proved completed writes.
 * Supply capturedIds from the reviewed prior receipt/native capture. All POSTs
 * are blocked; this entry point cannot re-enter create/split/status steps.
 * Separate completion-* artifacts preserve the original failed browser run.
 */
export async function runWorkSharesBrowserCompletion(input = {}) {
  return runWorkSharesBrowserScenario(input, true);
}

async function runWorkSharesBrowserScenario(input, completionOnly) {
  const binding = validateWorkSharesBrowserInput(input);
  const { plan, sessions, httpCredentials } = input;
  if (httpCredentials !== undefined) guard(record(httpCredentials) && typeof httpCredentials.username === "string" && typeof httpCredentials.password === "string", "HTTP_CREDENTIALS_INVALID");
  const prefix = completionOnly ? "completion" : "browser";
  const ids = completionOnly ? validateWorkSharesCompletionIds(plan, input.capturedIds) : { source: plan.source.id, dependent: plan.dependent.id, fractional: null, child: null, splitRequestId: null };
  const directory = privateDirectory(input.outputDir, binding.local, prefix);
  const origin = binding.origin;
  const projectPath = `/projects/${plan.project.id}`;
  const started = Date.now();
  const pending = new Set();
  const contexts = new Set();
  const pages = new Map();
  const blocked = new WeakSet();
  const actions = [];
  const checks = [];
  const screenshots = [];
  const failures = [];
  const actionIds = new Map();
  const secretValues = [...sessions.map((item) => item.cookie.value), httpCredentials?.username, httpCredentials?.password].filter(Boolean);
  if (httpCredentials) secretValues.push(Buffer.from(`${httpCredentials.username}:${httpCredentials.password}`).toString("base64"));
  let browser;
  let armed = null;
  let stopping = false;
  let uncertainMutation = false;
  let phase = "INITIALIZE";
  let failureCode = null;
  let counter = 0;
  let actionsDrained = false;

  function redact(value) {
    let text = String(value ?? "");
    for (const secret of secretValues) text = text.split(secret).join("[REDACTED]");
    return text.replace(/((?:authorization|proxy-authorization|cookie|set-cookie)["'\s]*[:=]\s*)[^\r\n]*/gi, "$1[REDACTED]")
      .replace(/\b(?:[A-Za-z0-9_-]{8,}\.){4}[A-Za-z0-9_-]+\b/g, "[REDACTED_JWE]");
  }
  function durable(file, bytes, replace = false) {
    const target = join(directory, file);
    const temp = replace ? `${target}.next` : target;
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, buffer); fsyncSync(fd); } finally { closeSync(fd); }
    guard(hash(readFileSync(temp)) === hash(buffer), "PRIVATE_EVIDENCE_READBACK_FAILED");
    if (replace) renameSync(temp, target);
  }
  function json(file, value, replace = false) { durable(file, JSON.stringify(value, null, 2) + "\n", replace); }
  function journal(event) {
    const file = join(directory, `${prefix}-journal.jsonl`);
    const fd = openSync(file, "a", 0o600);
    try { appendFileSync(fd, JSON.stringify({ at: new Date().toISOString(), phase, ...event }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  }
  function snapshot() {
    return { version: 1, runId: plan.runId, mode: completionOnly ? "READ_ONLY_COMPLETION" : "FULL_SCENARIO", target: binding.local ? "EXISTING_LOCAL" : "EXISTING_STAGING", status: failureCode ? "FAIL" : "RUNNING", signedSessions: true, passwordLogin: "NOT_TESTED", serviceWorkerMode: "API_UNAVAILABLE_IN_ISOLATED_TEST_CONTEXT", offlinePwaQa: "NOT_TESTED", capturedIds: { ...ids }, groupProof: "ROOT_CAPTURE_REQUIRED_FROM_SPLIT_RECEIPT", actions, checks, screenshots, failures, actionsDrained };
  }
  function persist() { json(`${prefix}-receipt.json`, snapshot(), true); }
  function fail(code, error) {
    failureCode ??= code;
    failures.push({ code, phase });
    stopping = true;
    journal({ event: "failure", code, error: { name: error?.name ?? "Error", message: redact(error?.message ?? code).slice(0, 5000) } });
  }
  async function drain(timeout = 35_000) {
    const deadline = Date.now() + timeout;
    while (pending.size) {
      const remaining = deadline - Date.now();
      guard(remaining > 0, "INTERCEPT_DRAIN_TIMEOUT");
      let timer;
      try { await Promise.race([Promise.allSettled([...pending]), new Promise((_, reject) => { timer = setTimeout(() => reject(new WorkSharesBrowserStop("INTERCEPT_DRAIN_TIMEOUT")), remaining); })]); }
      finally { clearTimeout(timer); }
    }
  }
  function checkLive() {
    guard(!stopping && !failureCode, failureCode ?? "BROWSER_STOPPED");
    guard(Date.now() - started < 10 * 60_000, "BROWSER_SESSION_WINDOW_EXCEEDED");
  }
  function track(promise) { pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; }
  function allowedPage(role, pathname) { return role === "manager" ? pathname === projectPath : ["/my", "/payroll"].includes(pathname); }
  function decodeArgs(request) {
    let args;
    try { args = JSON.parse(request.postData() ?? ""); } catch { throw new WorkSharesBrowserStop("ACTION_BODY_NOT_PLAIN_FLIGHT_JSON"); }
    guard(Array.isArray(args), "ACTION_ARGS_NOT_ARRAY");
    return args;
  }
  function validateIntent(intent, profile, args) {
    guard(intent && !intent.consumed && intent.role === profile.role, "UNARMED_OR_DUPLICATE_BROWSER_ACTION");
    if (intent.kind === "create") {
      guard(profile.role === "manager" && args.length === 1 && record(args[0]), "CREATE_SHAPE_INVALID");
      const data = args[0];
      guard(Object.keys(data).every((key) => ["projectId", "productId", "title", "type", "assigneeId", "workId", "quantity", "dueAt", "estimateMinutes", "requiresPhoto"].includes(key)), "CREATE_FIELDS_FORBIDDEN");
      guard(data.projectId === plan.project.id && [undefined, "$undefined", null].includes(data.productId) && data.workId === plan.work.id && data.title === plan.fractionalTitle && data.assigneeId === plan.users[0].id, "CREATE_TARGET_MISMATCH");
      guard(data.quantity === 0.3 && data.type === "Производство" && data.requiresPhoto === false && data.estimateMinutes === 1 && data.dueAt === plan.dueAt.slice(0, 10), "CREATE_VALUES_MISMATCH");
      guard(!ids.fractional && !actions.some((action) => action.kind === "create"), "ONLY_ONE_FRACTIONAL_CREATE_ALLOWED");
    } else if (intent.kind === "options") {
      guard(args.length === 1 && typeof args[0] === "string" && ID.test(args[0]), "OPTIONS_ARGS_INVALID");
      if (intent.discoverFractional) guard(profile.role === "worker" && ![plan.source.id, plan.dependent.id, plan.project.id, plan.work.id, ...plan.users.map((user) => user.id)].includes(args[0]) && !ids.fractional, "FRACTIONAL_ID_DISCOVERY_INVALID");
      else guard(args[0] === plan.source.id && profile.role === "worker", "OPTIONS_TARGET_MISMATCH");
    } else if (intent.kind === "split") {
      guard(profile.role === "worker" && args.length === 1 && record(args[0]) && same(Object.keys(args[0]).sort(), ["expectedRevision", "percent", "recipientId", "requestId", "taskId"]), "SPLIT_SHAPE_INVALID");
      const data = args[0];
      guard(data.taskId === plan.source.id && data.recipientId === plan.users[1].id && data.percent === "30.00" && data.expectedRevision === 0 && UUID.test(data.requestId), "SPLIT_TARGET_OR_NONCE_MISMATCH");
      guard(ids.fractional && !ids.child && !ids.splitRequestId && !actions.some((action) => action.kind === "split"), "ONLY_ONE_SPLIT_INTENT_ALLOWED");
    } else {
      guard(intent.kind === "status" && args.length === 2 && args[0] === intent.taskId && args[1] === intent.toStatus, "STATUS_ARGS_MISMATCH");
      guard(["IN_PROGRESS", "DONE"].includes(intent.toStatus), "STATUS_FORBIDDEN");
      const owned = profile.role === "worker" ? [plan.source.id, ids.fractional] : profile.role === "mounter" ? [plan.dependent.id, ids.child] : [];
      guard(owned.filter(Boolean).includes(intent.taskId), "STATUS_OUTSIDE_OWN_QA_TASKS");
      if (intent.copies === 2) guard(intent.taskId === ids.child && intent.toStatus === "DONE" && profile.role === "mounter", "DUPLICATE_DONE_TARGET_INVALID");
    }
    guard(intent.copies === 1 || (intent.copies === 2 && ["split", "status"].includes(intent.kind)), "UPSTREAM_COPY_COUNT_FORBIDDEN");
    intent.consumed = true;
  }
  function minimalOutcome(outcome, kind) {
    if (!outcome.ok) return { ok: false, error: redact(outcome.error ?? "").slice(0, 1000) };
    if (kind === "split") return { ok: true, childTaskId: outcome.childTaskId };
    if (kind === "options") return { ok: true, share: outcome.share, assigneeName: outcome.assigneeName };
    return { ok: true };
  }
  async function forward(route, profile, intent, args) {
    guard(!completionOnly, "READONLY_COMPLETION_POST_FORBIDDEN");
    const request = route.request();
    validateIntent(intent, profile, args);
    const actionId = request.headers()["next-action"];
    guard(typeof actionId === "string" && actionId.length > 0 && actionId.length < 256, "NEXT_ACTION_ID_REQUIRED");
    const previous = actionIds.get(intent.kind);
    guard(!previous || previous === actionId, "ACTION_ID_CHANGED_FOR_OPERATION");
    actionIds.set(intent.kind, actionId);
    const number = ++counter;
    const mutation = intent.kind !== "options";
    const captured = { number, phase, role: profile.role, kind: intent.kind, args, actionIdSha256: hash(actionId), requestBodySha256: hash(request.postData() ?? ""), copies: intent.copies, responses: [] };
    actions.push(captured); persist(); journal({ event: "upstream-intent", number, kind: intent.kind, role: profile.role, copies: intent.copies, requestBodySha256: captured.requestBodySha256 });
    const responses = await Promise.allSettled(Array.from({ length: intent.copies }, async (_, index) => {
      let stage = "fetch";
      try {
        // Exactly the captured request/body/headers, no redirect and no retries.
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
        stage = "body";
        const body = await response.body();
        const meta = { copy: index + 1, status: response.status(), bytes: body.length, sha256: hash(body), receivedAt: new Date().toISOString() };
        durable(`${prefix}-response-${number}-${index + 1}.rsc.txt`, redact(body.toString("utf8")));
        captured.responses.push(meta); persist();
        guard(response.status() === 200, "UPSTREAM_HTTP_NOT_200");
        stage = "parse";
        const outcome = workSharesActionOutcome(body);
        meta.outcome = minimalOutcome(outcome, intent.kind); meta.serverOutcomeObserved = true; persist();
        return { response, body, outcome };
      } catch (error) {
        if (mutation) uncertainMutation = true;
        journal({ event: "upstream-failed", number, copy: index + 1, stage, error: { name: error?.name, message: redact(error?.message).slice(0, 5000) } });
        throw error;
      }
    }));
    const rejected = responses.find((item) => item.status === "rejected");
    if (rejected) throw rejected.reason;
    const complete = responses.map((item) => item.value);
    if (intent.blocked) guard(complete.every((item) => item.outcome.ok === false && typeof item.outcome.error === "string" && item.outcome.error.includes("заблокирована")), "DEPENDENCY_NOT_BLOCKED");
    else guard(complete.every((item) => item.outcome.ok === true), "ACTION_REJECTED_BY_APPLICATION");
    if (intent.kind === "options") {
      const data = complete[0].outcome;
      const amount = intent.discoverFractional ? 30 : 1000;
      const quantity = intent.discoverFractional ? 0.3 : 10;
      guard(record(data.share) && data.share.units === 1_000_000 && Number(data.share.amount) === amount && Number(data.share.quantity) === quantity && data.share.currency === plan.currency && data.share.revision === 0 && data.assigneeName === plan.users[0].name && Array.isArray(data.options), "OPTIONS_SNAPSHOT_MISMATCH");
      if (intent.discoverFractional) ids.fractional = args[0];
    }
    if (intent.kind === "split") {
      const child = complete[0].outcome.childTaskId;
      guard(typeof child === "string" && ID.test(child) && ![plan.source.id, plan.dependent.id, ids.fractional].includes(child) && complete.every((item) => item.outcome.childTaskId === child), "SPLIT_NOT_IDEMPOTENT_OR_CHILD_INVALID");
      ids.child = child; ids.splitRequestId = args[0].requestId;
    }
    persist();
    await route.fulfill({ response: complete[0].response, body: complete[0].body });
    captured.forwarded = true; persist(); journal({ event: "forwarded", number, upstreamCopies: intent.copies, sha256: captured.responses[0].sha256 });
    intent.resolve({ args, outcomes: complete.map((item) => item.outcome), number });
  }
  async function intercept(route, profile) {
    const request = route.request();
    try {
      const url = new URL(request.url());
      guard(url.origin === origin, "CROSS_ORIGIN_REQUEST_FORBIDDEN");
      if (request.method() === "GET") {
        if (request.headers()["next-router-prefetch"] || request.headers().purpose === "prefetch") { blocked.add(request); await route.abort("blockedbyclient"); return; }
        const staticAsset = url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icons/") || ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest"].includes(url.pathname);
        guard(staticAsset || allowedPage(profile.role, url.pathname) || url.pathname === "/api/auth/session", "GET_OUTSIDE_QA_ROUTES");
        await route.continue(); return;
      }
      guard(request.method() === "POST" && allowedPage(profile.role, url.pathname) && request.headers()["next-action"], "NON_ACTION_WRITE_FORBIDDEN");
      const args = decodeArgs(request);
      // Notification polling has no arguments and catches transport failure.
      // Block it instead of admitting arbitrary unbound zero-argument actions.
      if (args.length === 0) { blocked.add(request); journal({ event: "unbound-background-action-blocked", role: profile.role }); await route.abort("blockedbyclient"); return; }
      guard(!completionOnly, "READONLY_COMPLETION_POST_FORBIDDEN");
      checkLive();
      await forward(route, profile, armed, args);
    } catch (error) {
      fail(error instanceof WorkSharesBrowserStop ? error.code : "INTERCEPT_FAILED", error);
      armed?.reject(error);
      await route.abort("failed").catch(() => {});
    }
  }
  async function verifySession(context, profile) {
    const response = await context.request.get(`${origin}/api/auth/session`, { timeout: 20_000, maxRetries: 0, maxRedirects: 0 });
    guard(response.status() === 200, "SESSION_HTTP_FAILED");
    const session = await response.json();
    guard(session?.user?.id === profile.userId && Array.isArray(session.user.roles), "SESSION_USER_MISMATCH");
    const expected = profile.role === "worker" ? ["WORKER"] : profile.role === "mounter" ? ["MOUNTER"] : null;
    guard(expected ? same(session.user.roles, expected) : session.user.roles.some((role) => ["ADMIN", "DIRECTOR", "MANAGER"].includes(role)), "SESSION_ROLE_MISMATCH");
  }
  async function act(role, spec, click) {
    guard(!completionOnly, "READONLY_COMPLETION_ACTION_FORBIDDEN");
    checkLive(); guard(!armed, "ACTION_ALREADY_ARMED");
    const page = pages.get(role);
    await verifySession(page.context(), binding.profiles[role]);
    let timer;
    const result = new Promise((resolvePromise, reject) => {
      armed = { copies: 1, ...spec, role, consumed: false, resolve: resolvePromise, reject };
      timer = setTimeout(() => reject(new WorkSharesBrowserStop("EXPECTED_ACTION_TIMEOUT")), 40_000);
    });
    // Attach a rejection handler before click waits for actionability.
    void result.catch(() => {});
    try { await click(); return await result; }
    finally { clearTimeout(timer); armed = null; }
  }
  async function step(name, run) {
    phase = name; checkLive(); const detail = await run(); await drain(); checkLive();
    checks.push({ check: name, status: "PASS", ...(detail ?? {}) }); persist();
  }
  async function visit(role, pathname) {
    const page = pages.get(role);
    guard(allowedPage(role, pathname), "SCRIPT_NAVIGATION_OUTSIDE_QA");
    const response = await page.goto(`${origin}${pathname}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    guard(response?.status() === 200 && new URL(page.url()).pathname === pathname && new URL(page.url()).origin === origin, "QA_PAGE_FAILED_OR_REDIRECTED");
    const sw = await page.evaluate(() => ({ apiAbsent: !("serviceWorker" in navigator), serwistAbsent: typeof window.serwist === "undefined" }));
    guard(sw.apiAbsent && sw.serwistAbsent && page.context().serviceWorkers().length === 0, "QA_SW_API_DISABLE_FAILED");
  }
  async function screenshot(page, name) {
    await page.evaluate(() => document.fonts.ready);
    const file = `${completionOnly ? "completion-" : ""}${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    guard(!existsSync(join(directory, file)), "SCREENSHOT_ALREADY_EXISTS");
    await page.screenshot({ path: join(directory, file), fullPage: false, animations: "disabled" });
    screenshots.push({ phase, file, ...page.viewportSize(), sha256: hash(readFileSync(join(directory, file))) }); persist();
  }
  async function noOverflow(page, dialog) {
    const width = page.viewportSize().width;
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width + 1);
    if (dialog) {
      await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const bounds = await dialog.boundingBox();
      guard(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height + 1, "DIALOG_OUTSIDE_VIEWPORT");
    }
  }
  function taskCard(page, title) { return page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) }); }
  async function ownCard(role, title) { const card = taskCard(pages.get(role), title); await expect(card).toHaveCount(1); await expect(card).toBeVisible(); return card; }
  async function tasksPanel() {
    const page = pages.get("manager");
    const tab = page.getByRole("tab", { name: /^Задачи/ }); await tab.click(); await expect(tab).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel"); await expect(panel).toHaveCount(1); return panel;
  }
  async function assertShare(role, title, percent, quantity, amount) {
    const card = await ownCard(role, title);
    await expect(card.getByText(`Ваша доля: ${percent}%`, { exact: true })).toBeVisible();
    await expect(card.getByText(`Личный объём: ${quantity.replace(".", ",")} ед.`, { exact: true })).toBeVisible();
    await expect(card.getByText(`Сумма доли: ${money(amount, plan.currency)}`, { exact: true })).toBeVisible();
    return card;
  }
  async function captureCardWidths(role, title, prefix) {
    const page = pages.get(role);
    for (const viewport of VIEWPORTS) { await page.setViewportSize(viewport); const card = await ownCard(role, title); await card.scrollIntoViewIfNeeded(); await noOverflow(page); await screenshot(page, `${prefix}-${viewport.width}`); }
  }
  async function blockedDependent(label) {
    await visit("mounter", "/my"); const page = pages.get("mounter"); const card = await ownCard("mounter", plan.dependent.title);
    await act("mounter", { kind: "status", taskId: ids.dependent, toStatus: "IN_PROGRESS", blocked: true }, () => card.getByRole("button", { name: "В работу", exact: true }).click());
    await expect(card.getByText("Новая", { exact: true })).toBeVisible();
    await expect(page.getByText(/Задача заблокирована/).last()).toBeVisible();
    return { stage: label, taskStayedNew: true, rejectedByServer: true };
  }
  async function finishWithTimer(role, title, taskId, copies = 1) {
    await visit(role, "/my"); const page = pages.get(role); let card = await ownCard(role, title);
    await act(role, { kind: "status", taskId, toStatus: "IN_PROGRESS" }, () => card.getByRole("button", { name: "В работу", exact: true }).click());
    card = await ownCard(role, title);
    await expect(card.getByText("В работе", { exact: true })).toBeVisible();
    await expect(page.getByText(`Идёт таймер: ${title}`, { exact: true })).toBeVisible();
    const stop = card.getByRole("button", { name: /^Стоп / }); await expect(stop).toBeVisible();
    await expect.poll(async () => workSharesTimerSeconds(await stop.innerText()) ?? -1).toBeGreaterThanOrEqual(1);
    await screenshot(page, `${role}-${taskId}-timer`);
    await act(role, { kind: "status", taskId, toStatus: "DONE", copies }, () => card.getByRole("button", { name: "Выполнено", exact: true }).click());
    card = await ownCard(role, title); await expect(card.getByText("Выполнена", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Стоп / })).toHaveCount(0);
    const text = await card.getByText(/^Время:/).innerText();
    const fact = /\/\s*(\d+)\s*мин/.exec(text);
    guard(fact && Number(fact[1]) >= 1, "ACTUAL_TIMER_MINUTES_MISSING");
    return { automaticTimerObserved: true, recordedMinutes: Number(fact[1]), doneUpstreamCopies: copies };
  }

  json(`${prefix}-started.json`, { version: 1, runId: plan.runId, origin, at: new Date().toISOString(), readonly: completionOnly, intentionalDuplicates: completionOnly ? [] : ["split-same-UUID", "child-DONE"], writesRetried: false });
  persist();
  try {
    browser = await chromium.launch({ headless: true });
    for (const role of ["manager", "worker", "mounter"]) {
      const profile = binding.profiles[role];
      const context = await browser.newContext({ baseURL: origin, viewport: VIEWPORTS[0], deviceScaleFactor: 1, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow", ignoreHTTPSErrors: false, serviceWorkers: "allow", ...(httpCredentials ? { httpCredentials } : {}) });
      contexts.add(context); await context.addCookies([{ ...profile.cookie }]);
      await context.addInitScript(() => {
        let owner = navigator;
        while (owner) {
          const descriptor = Object.getOwnPropertyDescriptor(owner, "serviceWorker");
          if (descriptor) {
            if (!descriptor.configurable || !Reflect.deleteProperty(owner, "serviceWorker")) throw new Error("QA_SW_API_DISABLE_FAILED");
            break;
          }
          owner = Object.getPrototypeOf(owner);
        }
        if ("serviceWorker" in navigator) throw new Error("QA_SW_API_DISABLE_FAILED");
      });
      await context.route("**/*", (route) => track(intercept(route, profile)));
      const page = await context.newPage(); pages.set(role, page);
      page.setDefaultTimeout(20_000);
      page.on("pageerror", (error) => { fail("BROWSER_PAGE_ERROR", error); });
      page.on("console", (message) => { if (message.type() === "error") journal({ event: "browser-console-error", role, message: redact(message.text()).slice(0, 3000) }); });
      page.on("requestfailed", (request) => { journal({ event: "request-failed", role, method: request.method(), pathname: new URL(request.url()).pathname, intentionallyBlocked: blocked.has(request), reason: redact(request.failure()?.errorText).slice(0, 500) }); });
      await verifySession(context, profile);
    }
    await step("sessions", async () => ({ verifiedProfiles: 3, passwordLogin: "NOT_TESTED", tlsVerification: true }));
    if (!completionOnly) {
    await step("create-fractional-C-with-All", async () => {
      await visit("manager", projectPath); const page = pages.get("manager"); const panel = await tasksPanel();
      await expect(panel.locator('[data-slot="card"]')).toHaveCount(2);
      await expect(panel.getByText(plan.source.title, { exact: true })).toBeVisible();
      await expect(panel.getByText(plan.dependent.title, { exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Задача", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Новая задача", exact: true }); await expect(dialog.getByRole("heading", { name: "Новая задача", exact: true })).toBeVisible();
      await dialog.getByLabel("Название *", { exact: true }).fill(plan.fractionalTitle);
      await dialog.getByRole("button", { name: "не назначен — черновик", exact: true }).click();
      await page.getByPlaceholder("Поиск сотрудника…").fill(plan.users[0].name);
      await page.getByRole("button", { name: new RegExp(`^${re(plan.users[0].name)}`) }).click();
      await dialog.getByLabel("Срок *", { exact: true }).fill(plan.dueAt.slice(0, 10));
      await dialog.getByLabel("Оценка времени, мин", { exact: true }).fill("1");
      await dialog.getByRole("button", { name: "без работы", exact: true }).click();
      await page.getByPlaceholder("Поиск работы…").fill(plan.work.title);
      await page.getByRole("button", { name: new RegExp(`^${re(plan.work.title)}`) }).click();
      const quantity = dialog.locator('input[type="number"][step="0.01"]');
      await quantity.fill("0.301"); await expect(dialog.getByRole("button", { name: "Создать", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Все", exact: true }).click(); await expect(quantity).toHaveValue("0.30");
      await noOverflow(page, dialog); await screenshot(page, "create-fractional-360");
      await act("manager", { kind: "create" }, () => dialog.getByRole("button", { name: "Создать", exact: true }).click());
      await expect(dialog).toBeHidden(); await expect(panel.locator('[data-slot="card"]')).toHaveCount(3);
      return { exactQuantity: "0.30", genuineThirdDecimalRejected: true, tasksAfterCreate: 3 };
    });
    await step("discover-C-from-real-readonly-options", async () => {
      await visit("worker", "/my"); const page = pages.get("worker"); const card = await assertShare("worker", plan.fractionalTitle, "100", "0.3", 30);
      await act("worker", { kind: "options", discoverFractional: true }, () => card.getByRole("button", { name: "Разделить", exact: true }).click());
      const dialog = page.getByRole("dialog", { name: "Разделить задачу", exact: true }); await expect(dialog.getByRole("heading", { name: "Разделить задачу", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click(); await expect(dialog).toBeHidden();
      guard(ids.fractional, "FRACTIONAL_ID_NOT_OBSERVED"); return { fractionalIdObserved: true, budget: "30.00" };
    });
    await step("split-A-30-percent-with-same-UUID-concurrency", async () => {
      const page = pages.get("worker"); const card = await assertShare("worker", plan.source.title, "100", "10", 1000);
      await act("worker", { kind: "options" }, () => card.getByRole("button", { name: "Разделить", exact: true }).click());
      const dialog = page.getByRole("dialog", { name: "Разделить задачу", exact: true });
      await dialog.getByRole("button", { name: "Выберите сотрудника", exact: true }).click();
      await page.getByPlaceholder("Поиск по имени или роли…").fill(plan.users[1].name);
      await page.getByRole("button", { name: new RegExp(`^${re(plan.users[1].name)}`) }).click();
      await dialog.getByLabel("Передать от текущей доли, %", { exact: true }).fill("30");
      const retained = dialog.getByText("Останется исходному исполнителю", { exact: true }).locator("..");
      const transferred = dialog.getByText("Будет передано", { exact: true }).locator("..");
      await expect(retained.getByText("70%", { exact: true })).toBeVisible(); await expect(retained.getByText(`700,00 ${plan.currency}`, { exact: true })).toBeVisible();
      await expect(transferred.getByText("30%", { exact: true })).toBeVisible(); await expect(transferred.getByText(`300,00 ${plan.currency}`, { exact: true })).toBeVisible();
      const submit = dialog.getByRole("button", { name: "Разделить задачу", exact: true });
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport); await noOverflow(page, dialog); await retained.scrollIntoViewIfNeeded(); await screenshot(page, `split-preview-${viewport.width}`);
        await submit.scrollIntoViewIfNeeded(); guard((await submit.boundingBox())?.height >= 48, "MOBILE_SPLIT_TARGET_TOO_SMALL"); await screenshot(page, `split-footer-${viewport.width}`);
      }
      await act("worker", { kind: "split", copies: 2 }, () => submit.click()); await expect(dialog).toBeHidden();
      await assertShare("worker", plan.source.title, "70", "7", 700); await captureCardWidths("worker", plan.source.title, "source-70-share");
      await visit("mounter", "/my"); await assertShare("mounter", plan.source.title, "30", "3", 300); await captureCardWidths("mounter", plan.source.title, "child-30-share");
      return { splitRequestIdObserved: true, upstreamCopies: 2, uniqueChildTaskIds: 1, sourceAmount: "700.00", childAmount: "300.00" };
    });
    await step("dependent-blocked-before-both-parts", () => blockedDependent("before A and D"));
    await step("source-A-auto-timer-and-DONE", () => finishWithTimer("worker", plan.source.title, ids.source));
    await step("dependent-still-blocked-after-A", () => blockedDependent("A done, D unfinished"));
    await step("child-D-auto-timer-and-double-DONE", () => finishWithTimer("mounter", plan.source.title, ids.child, 2));
    await step("dependent-B-unblocked-without-Work", () => finishWithTimer("mounter", plan.dependent.title, ids.dependent));
    await step("fractional-C-auto-timer-and-DONE", () => finishWithTimer("worker", plan.fractionalTitle, ids.fractional));
    }
    await step("actual-personal-payroll-no-duplicate", async () => {
      for (const role of ["worker", "mounter"]) {
        await visit(role, "/payroll"); const page = pages.get(role); await page.setViewportSize(VIEWPORTS[1]);
        await expect(page.locator("h1:not(header h1)").filter({ hasText: /^Моя зарплата$/ })).toBeVisible();
        const sourceRows = page.getByRole("row").filter({ hasText: plan.source.title }); await expect(sourceRows).toHaveCount(1);
        await expect(sourceRows.getByRole("cell", { name: money(role === "worker" ? 700 : 300, plan.currency), exact: true })).toBeVisible();
        const fractionalRows = page.getByRole("row").filter({ hasText: plan.fractionalTitle }); await expect(fractionalRows).toHaveCount(role === "worker" ? 1 : 0);
        if (role === "worker") await expect(fractionalRows.getByRole("cell", { name: money(30, plan.currency), exact: true })).toBeVisible();
        await expect(page.getByRole("row").filter({ hasText: plan.dependent.title })).toHaveCount(0);
        const estimate = page.locator('[data-slot="card"]').filter({ has: page.getByText("Приблизительная зарплата", { exact: true }) });
        await expect(estimate.getByText(money(role === "worker" ? 730 : 300, plan.currency), { exact: true })).toBeVisible();
        await sourceRows.scrollIntoViewIfNeeded(); await screenshot(page, `${role}-payroll-one-entry-per-task`);
      }
      return { workerRows: 2, mounterRows: 1, workerTotal: "730.00", mounterTotal: "300.00", nativeCaptureStillRequired: true };
    });
    await step("final-owned-project-four-completed-tasks", async () => {
      await visit("manager", projectPath); const panel = await tasksPanel();
      await expect(panel.locator('[data-slot="card"]')).toHaveCount(4); await expect(panel.getByText("Выполнена", { exact: true })).toHaveCount(4);
      await expect(panel.getByText("распределена полностью", { exact: true })).toHaveCount(1);
      for (const viewport of VIEWPORTS) { const page = pages.get("worker"); await page.setViewportSize(viewport); await visit("worker", "/my"); const card = await ownCard("worker", plan.source.title); await card.scrollIntoViewIfNeeded(); await noOverflow(page); await screenshot(page, `worker-final-cards-${viewport.width}`); }
      return { taskCount: 4, workQuantityFullyAllocated: "10.30", allDone: true };
    });
  } catch (error) {
    fail(error instanceof WorkSharesBrowserStop ? error.code : "UI_SCENARIO_FAILED", error);
    for (const [role, page] of pages) if (!page.isClosed()) {
      try { await screenshot(page, `failure-${role}`); } catch (captureError) { journal({ event: "failure-screenshot-error", role, message: redact(captureError?.message).slice(0, 2000) }); }
    }
    json(`${prefix}-error.json`, { runId: plan.runId, phase, code: failureCode, error: { name: error?.name, message: redact(error?.message).slice(0, 6000) }, capturedIds: ids });
  } finally {
    stopping = true;
    let closureConfirmed = true;
    try { await drain(); } catch (error) { closureConfirmed = false; fail("PRE_CLOSE_DRAIN_FAILED", error); }
    for (const context of contexts) {
      try { await context.close(); } catch (error) { closureConfirmed = false; fail("CONTEXT_CLOSE_FAILED", error); }
    }
    if (browser) try { await browser.close(); } catch (error) { closureConfirmed = false; fail("BROWSER_CLOSE_FAILED", error); }
    try { await drain(10_000); } catch (error) { closureConfirmed = false; fail("POST_CLOSE_DRAIN_FAILED", error); }
    actionsDrained = closureConfirmed && pending.size === 0 && !uncertainMutation;
    if (!actionsDrained) failureCode ??= "UPSTREAM_MUTATION_QUIESCENCE_UNPROVEN";
    persist();
    if (closureConfirmed && pending.size === 0) json(`${prefix}-drained.json`, { version: 1, runId: plan.runId, at: new Date().toISOString(), actionsDrained, contextsClosed: true, browserClosed: true, interceptsPending: 0, uncertainMutation });
  }
  const result = { ...snapshot(), status: failureCode ? "FAIL" : "PASS", elapsedMs: Date.now() - started };
  json(`${prefix}-receipt.json`, result, true);
  if (failureCode) { const error = new WorkSharesBrowserStop(failureCode); error.receipt = result; throw error; }
  return result;
}
