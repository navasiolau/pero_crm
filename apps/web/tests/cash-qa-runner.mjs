/** Local cash QA runner. Import performs no DB, Docker, browser or filesystem operation. */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync,
  realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertContainerIdentity } from "./work-shares-local-migrate.mjs";
import { canonical, cashPlanSha256, cashRawFingerprints,
  validateCashQaPlan } from "./cash-owned-fixtures.mjs";
import { createCashQaSqlAdapter, probeCashQaDatabase } from "./cash-qa-adapter.mjs";
import { runCashNativeAcceptance } from "./cash-native-acceptance.ts";
import { cashMigrationProjection } from "./cash-local-migrate.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), ".."), ROOT = resolve(WEB, "../..");
const HEAD = "3f6da0da082cc707370346c9c3a458ba24d1c189";
const SQL_SHA = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd";
const LOCAL = { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  host: "127.0.0.1", port: 5433, database: "pero_crm" };
const IDS = Object.freeze({ runId: "a1677358-663c-4d50-8dc8-d84f3de04680", project: "f7b48bfc-08de-4740-90ec-3cf209038525",
  activeUser: "96a0aa21-25aa-4b8a-adc8-1af2e3c5813b", inactiveUser: "9088c3a2-7071-4eb3-9268-e29b93d69993",
  cashByn: "ffd0e2c3-0815-4d85-84a3-a0eb1ff1244d", cashUsd: "8ce42d32-321c-4398-8b52-042b5a438c97",
  paymentByn: "54d42f90-8fcc-49c8-8337-1d8d6c2fc4c1", paymentOther: "546cb409-d9b6-492e-aa37-e6ed224787f0",
  accrual: "f442aee5-1112-43ac-a4b2-9f6a87f5f145", advanceRequest: "75f151d3-8df6-405c-a4df-98b000ec3049",
  salaryRequest: "f1b70254-6da7-4c33-9d6d-35e4a03a4adc", usdRequest: "fac0a6de-9ba9-4889-a76f-9d7f7ddc427a",
  deleteRequest: "79ebd916-4de4-49e6-b8af-2929e4038d1c" });
const REQUIRE = createRequire(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => canonical(a) === canonical(b);
const check = (ok, code) => { if (!ok) throw new Error(code); };

export function assertCashQaSource({ platform, root, cwd, head, sqlSha, env }) {
  check(platform === "win32" && String(root).toLowerCase() === "d:\\projects\\pero_crm_worktrees\\manager-cash-advances" &&
    String(cwd).toLowerCase() === "d:\\projects\\pero_crm_worktrees\\manager-cash-advances\\apps\\web", "SOURCE_WORKTREE_FORBIDDEN");
  check(head === HEAD, "SOURCE_REVISION_MISMATCH");
  check(sqlSha === SQL_SHA, "SQL_SHA_MISMATCH");
  for (const key of ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL", "DOCKER_HOST", "PGHOST", "PGPORT", "PGSERVICE",
    "PGSERVICEFILE", "PGOPTIONS", "NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "PRISMA_CONFIG"])
    check(!env?.[key], "AMBIENT_OVERRIDE_FORBIDDEN");
  return true;
}

export function assertCashHookSafety(snapshot) {
  const plugins = (snapshot.rows?.Plugin ?? []).map((raw) => JSON.parse(raw));
  check(plugins.every((plugin) => ["demo", "file-stages"].includes(plugin.id)), "UNKNOWN_PLUGIN_REGISTERED");
  check(!plugins.some((plugin) => plugin.id === "demo" && plugin.enabled === true), "UNATTRIBUTABLE_PLUGIN_HOOK");
  return true;
}

/** Check app-start side effects before choosing a fixture baseline. */
export function assertCashStartupDelta(prestart, post) {
  check(Array.isArray(prestart?.schemaTables) && Array.isArray(post?.schemaTables) &&
    prestart.schemaHash === post.schemaHash && same(prestart.schemaTables, post.schemaTables), "STARTUP_SCHEMA_DRIFT");
  const after = cashRawFingerprints(post, post.schemaTables);
  for (const table of post.schemaTables) if (table !== "Plugin")
    check(after[table] === prestart.fingerprints?.[table], "STARTUP_BUSINESS_DRIFT");
  const beforePlugins = (prestart.pluginRows ?? []).map((raw) => JSON.parse(raw));
  const afterPlugins = (post.rows?.Plugin ?? []).map((raw) => JSON.parse(raw));
  const stable = (rows) => rows.map((row) => { const copy = { ...row }; delete copy.updatedAt; return copy; })
    .sort((a, b) => a.id.localeCompare(b.id));
  check(beforePlugins.length === afterPlugins.length && beforePlugins.every((plugin) => ["demo", "file-stages"].includes(plugin.id)) &&
    same(stable(beforePlugins), stable(afterPlugins)), "STARTUP_PLUGIN_DRIFT");
  assertCashHookSafety(post);
  return { allowedPluginOnly: true, beforePluginHash: prestart.fingerprints.Plugin, afterPluginHash: after.Plugin };
}

const ARITY = Object.freeze({ "dry-run": 0, prestart: 1, "refs-local": 2, "select-local": 5,
  "plan-local": 4, "diagnose-plan-local": 4, "approve-local": 3, "approve-usd-exception": 4, prepare: 3,
  "capture-initial": 3, "browser-local": 5, "readonly-browser-local": 3, "capture-advance": 3,
  "remaining-local": 4, "capture-remaining": 4, "inspect-uncertain": 4, "fx-preview-local": 3, negative: 3,
  "lock-proof": 3, capture: 5, cleanup: 7 });
export function parseCashRunnerArgs(args) {
  if (!args.length) return { operation: "dry-run", paths: [] };
  const [operation, ...paths] = args;
  check(Object.hasOwn(ARITY, operation) && paths.length === ARITY[operation], "RUNNER_USAGE_INVALID");
  return { operation, paths };
}

/** Injected runtime is only consulted after parsing/guards; default does zero I/O. */
/** @param {{args?: string[], runtime?: {execute: (request: {operation: string, paths: string[]}) => Promise<unknown>}}} input */
export async function runCashQaRunner({ args = [], runtime } = {}) {
  const request = parseCashRunnerArgs(args);
  if (request.operation === "dry-run") return { status: "DRY_RUN", connectionOpened: false,
    operations: Object.keys(ARITY).filter((name) => name !== "dry-run") };
  check(runtime && typeof runtime.execute === "function", "REVIEWED_RUNTIME_REQUIRED");
  return runtime.execute(request);
}

function command(exe, args) { return execFileSync(exe, args, { encoding: "utf8", windowsHide: true,
  timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function source() {
  const sqlFile = join(WEB, "prisma", "migrations", "20260929120000_manager_cash_advances", "migration.sql");
  const current = { platform: process.platform, root: realpathSync(ROOT), cwd: realpathSync(process.cwd()),
    head: command("git", ["rev-parse", "HEAD"]), sqlSha: sha(readFileSync(sqlFile)), env: process.env };
  assertCashQaSource(current);
  for (const dir of [ROOT, WEB, join(WEB, "prisma")])
    check(!readdirSync(dir).some((name) => name === ".env" || (name.startsWith(".env.") && name !== ".env.example") ||
      /^prisma\.config\./.test(name)), "ALTERNATE_CONFIG_FORBIDDEN");
  check(REQUIRE("prisma/package.json").version === "6.19.3", "PRISMA_VERSION_MISMATCH");
  return { head: current.head, sqlSha: current.sqlSha,
    schemaSha: sha(readFileSync(join(WEB, "prisma", "schema.prisma"))) };
}

function privatePath(path, prefix, filename) {
  check(typeof path === "string" && resolve(path) === path && existsSync(path) && !lstatSync(path).isSymbolicLink() &&
    lstatSync(path).isFile(), "PRIVATE_FILE_REQUIRED");
  const actual = realpathSync(path), directory = dirname(actual);
  check(dirname(directory).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    directory.toLowerCase().includes(prefix.toLowerCase()) && (!filename || actual === join(directory, filename)),
  "PRIVATE_FILE_FORBIDDEN");
  return actual;
}
function readPrivate(path, prefix, filename) {
  const selected = privatePath(path, prefix, filename), bytes = readFileSync(selected);
  const digestFile = `${selected}.sha.json`;
  check(existsSync(digestFile) && JSON.parse(readFileSync(digestFile, "utf8")).sha256 === sha(bytes), "PRIVATE_READBACK_FAILED");
  return JSON.parse(bytes.toString("utf8"));
}
export function inspectCashPrestart(prestartPath, runtimeInput) {
  const receipt = readPrivate(prestartPath, "pero-cash-qa-local-", "prestart.json");
  check(receipt.runId === IDS.runId && same(receipt.targetIdentity, runtimeInput.target.identity) &&
    receipt.migrationReceiptSha256 === runtimeInput.evidence.receiptSha256 &&
    Array.isArray(receipt.schemaTables) && receipt.schemaTables.length === 38, "PRESTART_RUNTIME_MISMATCH");
  return { directory: dirname(prestartPath), runId: receipt.runId,
    migrationReceiptSha256: receipt.migrationReceiptSha256 };
}
function savePrivate(directory, filename, value) {
  const file = join(directory, filename), bytes = Buffer.from(canonical(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  const proof = Buffer.from(JSON.stringify({ sha256: sha(bytes) }) + "\n"), sf = openSync(`${file}.sha.json`, "wx", 0o600);
  try { writeFileSync(sf, proof); fsyncSync(sf); } finally { closeSync(sf); }
  check(sha(readFileSync(file)) === sha(bytes), "PRIVATE_READBACK_FAILED");
  return file;
}
function privateDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "pero-cash-qa-local-"));
  const sid = command("whoami", ["/user", "/fo", "csv", "/nh"]).match(/S-1-\d+(?:-\d+)+/g);
  check(sid?.length === 1, "OWNER_SID_REQUIRED");
  command("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  return directory;
}

function migrationReceipt(path, src) {
  const receiptFile = privatePath(path, "pero-cash-migration-", "receipt.json");
  const dir = dirname(receiptFile), bytes = readFileSync(receiptFile), receipt = JSON.parse(bytes.toString("utf8"));
  check(JSON.parse(readFileSync(join(dir, "receipt.sha.json"), "utf8")).sha === sha(bytes), "MIGRATION_RECEIPT_DRIFT");
  const applied = JSON.parse(readFileSync(join(dir, "applied.json"), "utf8"));
  check(receipt.migration === "20260929120000_manager_cash_advances" && receipt.sqlSha === SQL_SHA &&
    applied.status === "APPLIED_AND_PRESERVED" && receipt.source.schemaSha === src.schemaSha &&
    receipt.source.manifest.find((row) => row.name === receipt.migration)?.sha256 === SQL_SHA, "MIGRATION_PROOF_MISMATCH");
  const archive = readFileSync(join(dir, "database.dump.out"));
  check(archive.subarray(0, 5).toString() === "PGDMP" && sha(archive) === receipt.dumpSha &&
    readFileSync(join(dir, "backup-toc.out")).length > 0 && readFileSync(join(dir, "backup-readable.out")).length > 0 &&
    !readFileSync(join(dir, "backup-toc.err")).length && !readFileSync(join(dir, "backup-readable.err")).length,
  "BACKUP_PROOF_MISMATCH");
  return { receipt, applied, backup: { verified: true, targetKind: LOCAL.kind, database: LOCAL.database,
    archiveSha256: sha(archive), tocSha256: sha(readFileSync(join(dir, "backup-toc.out"))),
    fullReadSha256: sha(readFileSync(join(dir, "backup-readable.out"))) }, receiptSha256: sha(bytes) };
}

function localTarget(receipt) {
  const context = JSON.parse(command("docker", ["context", "inspect", "desktop-linux"]))[0];
  check(context.Endpoints.docker.Host === "npipe:////./pipe/dockerDesktopLinuxEngine", "DOCKER_ENDPOINT_MISMATCH");
  const container = JSON.parse(command("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"]))[0];
  const identity = assertContainerIdentity(container);
  check(same(identity, receipt.target) && identity.id === LOCAL.containerId, "TARGET_DRIFT");
  const password = container.Config.Env.find((entry) => entry.startsWith("POSTGRES_PASSWORD="))?.slice(18);
  check(typeof password === "string" && password.length > 0, "DB_SECRET_UNAVAILABLE");
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = "pero"; url.password = password;
  return { identity, datasourceUrl: url.href };
}

/** Local app launcher only: target proof and secret stay in memory; no DB connection. */
export function inspectCashLocalRuntimeInput(migrationPath) {
  const src = source(), evidence = migrationReceipt(migrationPath, src), target = localTarget(evidence.receipt);
  return { src, evidence, target };
}

export function inspectCashLocalBuild() {
  const src = source();
  const paths = ["apps/web/src", "apps/web/prisma", "apps/web/package.json", "pnpm-lock.yaml",
    "apps/web/next.config.ts", "apps/web/next.config.mjs", "apps/web/next.config.js"];
  check(!command("git", ["diff", "--name-only", "HEAD", "--", ...paths]) &&
    !command("git", ["ls-files", "--others", "--exclude-standard", "--", ...paths]), "RUNTIME_INPUT_DIRTY");
  const buildFile = join(WEB, ".next", "BUILD_ID"), manifestFile = join(WEB, ".next", "server", "server-reference-manifest.json");
  check([buildFile, manifestFile].every((file) => existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink()),
    "REVIEWED_BUILD_MISSING");
  const buildId = readFileSync(buildFile, "utf8").trim(), bytes = readFileSync(manifestFile);
  const manifest = JSON.parse(bytes.toString("utf8"));
  assertCashBuildManifest(manifest);
  return { head: src.head, buildId, manifestSha256: sha(bytes), schemaSha256: src.schemaSha, sqlSha256: src.sqlSha };
}

export function assertCashRuntimeBinding(started, build, prestart, secretDoc, stopped) {
  check(!stopped && started?.origin === "http://127.0.0.1:3106" &&
    Number.isSafeInteger(started.pid) && started.pid > 0 &&
    started.migrationReceiptSha256 === prestart.migrationReceiptSha256 &&
    started.secretDigest === secretDoc.digest && same(started.build, build), "RUNTIME_RECEIPT_MISMATCH");
  return true;
}

/** Evidence is rooted in the known request UUID and browser-returned payout ID, never names or timestamps. */
export function deriveCashAdvanceObserved(snapshot, plan, browserResult) {
  check(browserResult?.status === "FORM_ADVANCE_CREATED" && browserResult.runId === plan.runId &&
    browserResult.captured?.requestId === plan.requestIds.advance &&
    typeof browserResult.captured.payoutId === "string", "BROWSER_RESULT_NOT_CONFIRMED");
  const payoutId = browserResult.captured.payoutId;
  const rows = (table) => snapshot.rows[table].map((raw) => JSON.parse(raw));
  const receipt = rows("ChangeLog").find((row) => row.id === `payout-issue:${plan.requestIds.advance}`);
  check(receipt?.entityId === payoutId && receipt.actorId === plan.actors.managerId &&
    receipt.newValue?.kind === "ADVANCE" && receipt.newValue?.userId === plan.users[0].id,
  "ADVANCE_RECEIPT_MISMATCH");
  const events = rows("DomainEvent").filter((row) => row.type === "payroll.payout" && row.payload?.payoutId === payoutId);
  check(events.length === 1 && events[0].actor === plan.actors.managerId, "ADVANCE_EVENT_MISMATCH");
  const expectedPairs = [`payroll.payout|${plan.users[0].id}`,
    ...plan.actors.financeRecipientIds.filter((id) => id !== plan.actors.managerId).map((id) => `payroll.orgPayout|${id}`)];
  const notifications = rows("Notification").filter((row) => typeof row.body === "string" &&
    row.body.includes(`QA-CASH ${plan.runId}`) && expectedPairs.includes(`${row.type}|${row.userId}`));
  check(notifications.length === expectedPairs.length &&
    same(notifications.map((row) => `${row.type}|${row.userId}`).sort(), [...expectedPairs].sort()),
  "ADVANCE_NOTIFICATION_MISMATCH");
  return { outcomes: [{ requestId: plan.requestIds.advance, payoutId, deleted: false }],
    effectIds: { DomainEvent: [events[0].id], Notification: notifications.map((row) => row.id), ChangeLog: [] },
    duplicateReplay: true };
}

export function assertCashBuildManifest(manifest) {
  const entries = Object.values(manifest.node ?? {});
  const expected = ["issueAdvance", "previewCashPayout"];
  check(expected.every((name) => entries.some((row) =>
    row.exportedName === name && row.filename?.replaceAll("\\", "/").endsWith("/src/server/payroll/cash-actions.ts"))),
  "BUILD_ACTIONS_OR_SOURCE_MISMATCH");
  return true;
}

async function migrationHashes(prisma, tables) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const result = {};
    for (const table of tables) {
      const projection = cashMigrationProjection(table); // static table-name allowlist from live catalog guard
      const query = `SELECT count(*)::text AS count,md5(COALESCE(string_agg(d,'' ORDER BY d COLLATE "C"),'')) AS hash FROM (SELECT md5((${projection})::text) AS d FROM public."${table}" t) q`;
      const [summary] = await tx.$queryRawUnsafe(query);
      result[table] = summary;
    }
    return result;
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}

async function localContext(migrationPath) {
  const src = source(), evidence = migrationReceipt(migrationPath, src);
  const target = localTarget(evidence.receipt);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: target.datasourceUrl } } });
  try {
    const facts = await probeCashQaDatabase(prisma, LOCAL, SQL_SHA);
    check(facts.dbUser === "pero" && facts.schemaTables.length === 38, "LOCAL_DATABASE_FACTS_MISMATCH");
    const attestation = { source: "verified-runner", target: LOCAL, proofSha256: sha(canonical({ src, identity: target.identity,
      migrationReceiptSha256: evidence.receiptSha256, facts })), ...facts, verifiedAt: new Date().toISOString(),
      backup: evidence.backup };
    return { src, evidence, target, prisma, attestation };
  } catch (error) { await prisma.$disconnect(); throw error; }
}

function snapshotAdapter(context, plan = null, approvedCapture = null, writeAuthorization = null) {
  return createCashQaSqlAdapter({ prisma: context.prisma, target: LOCAL, attestation: context.attestation,
    plan, approvedCapture, writeAuthorization });
}

function priorMonth() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); }
export function bynForUsd(rate) {
  check(/^\d+\.\d{6}$/.test(rate), "FX_RATE_INVALID");
  const millionths = BigInt(rate.replace(".", ""));
  const cents = (100000n * millionths + 500000n) / 1000000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function expectedCashQaFinal(plan, localUsdException = false) {
  const formatted = (cents) => `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
  if (plan.mode === "BYN_FALLBACK") return { bynCash: "1680.00", usdCash: "0.00",
    inactiveDue: "300.00", orgDeltaByn: "1680.00" };
  check(plan.mode === "USD" && /^\d+\.\d{6}$/.test(plan.fxProof?.rate ?? ""), "FINAL_RATE_PROOF_INVALID");
  const millionths = BigInt(plan.fxProof.rate.replace(".", ""));
  const bynCents = (cashCents) => (cashCents * millionths + 500000n) / 1000000n;
  return { bynCash: "680.00", usdCash: localUsdException ? "1000.00" : "950.00", inactiveDue: "300.00",
    orgDeltaByn: formatted(100000n + bynCents(100000n) - 12000n - 20000n -
      (localUsdException ? 0n : bynCents(5000n))) };
}

export function assertLocalUsdException(plan, approval, refusal, salaryCapture) {
  check(plan.target.kind === "EXISTING_LOCAL" && plan.mode === "USD" &&
    approval?.source === "owner-explicit-local-vpn-exception" &&
    approval.planSha256 === cashPlanSha256(plan) && approval.refusalGraphHash === refusal.graphHash &&
    refusal.status === "EXPLICIT_FX_REFUSAL_NO_WRITE" &&
    refusal.graphHash === salaryCapture.graphHash &&
    same(approval.expectedFunctional, expectedCashQaFinal(plan, true)),
  "LOCAL_USD_EXCEPTION_PROOF_INVALID");
  return true;
}

export function cashQaEligibleRefs(snapshot) {
  const users = snapshot.rows.User.map((raw) => JSON.parse(raw));
  const clients = snapshot.rows.Client.map((raw) => JSON.parse(raw));
  const eligible = (roles) => users.filter((row) => row.active && row.roles.some((role) => roles.includes(role)))
    .map((row) => ({ id: row.id, roles: row.roles })).sort((a, b) => a.id.localeCompare(b.id));
  return { managers: eligible(["ADMIN", "DIRECTOR", "MANAGER"]),
    finance: eligible(["ADMIN", "DIRECTOR", "ACCOUNTANT"]),
    clientIds: clients.map((row) => row.id).sort() };
}

export function assertCashAttemptVacant(names, operation) {
  check(["prepare", "cleanup"].includes(operation), "ATTEMPT_OPERATION_INVALID");
  const result = operation === "prepare" ? "prepared.json" : "cleaned.json";
  check(![`${operation}-intent.json`, `${operation}-intent.json.sha.json`, result, `${result}.sha.json`]
    .some((name) => names.includes(name)), "PRIOR_WRITE_ATTEMPT_REVIEW_REQUIRED");
  return true;
}

async function poststartSnapshot(context, prestartPath) {
  const prestart = readPrivate(prestartPath, "pero-cash-qa-local-", "prestart.json");
  check(same(prestart.targetIdentity, context.target.identity) && prestart.schemaHash === context.attestation.schemaHash &&
    prestart.migrationReceiptSha256 === context.evidence.receiptSha256, "PRESTART_RECEIPT_DRIFT");
  const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
  assertCashStartupDelta(prestart, snapshot);
  return snapshot;
}

async function planLocal(context, prestartPath, selectionPath, mode, diagnostic = false) {
  let phase = "INPUT";
  try {
  check(["USD", "BYN_FALLBACK"].includes(mode), "FX_MODE_INVALID");
  phase = "SELECTION";
  const selection = readPrivate(selectionPath, "pero-cash-qa-local-", "selection.json");
  check(dirname(selectionPath) === dirname(prestartPath), "SELECTION_DIRECTORY_MISMATCH");
  phase = "SNAPSHOT";
  const snapshot = await poststartSnapshot(context, prestartPath);
  assertCashHookSafety(snapshot);
  phase = "ACTORS";
  const users = snapshot.rows.User.map((raw) => JSON.parse(raw));
  const clients = snapshot.rows.Client.map((raw) => JSON.parse(raw));
  const manager = users.find((row) => row.id === selection.managerId && row.active &&
    row.roles.some((role) => ["ADMIN", "DIRECTOR", "MANAGER"].includes(role)));
  const finance = users.find((row) => row.id === selection.financeId && row.active &&
    row.roles.some((role) => ["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(role)));
  check(manager && finance && clients.some((row) => row.id === selection.clientId), "ACTOR_OR_CLIENT_FORBIDDEN");
  const pref = snapshot.rows.NotificationPreference.map((raw) => JSON.parse(raw));
  const financeRecipientIds = users.filter((row) => row.active && row.roles.some((role) => ["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(role)) &&
    pref.find((p) => p.userId === row.id && p.type === "payroll.orgPayout")?.enabled !== false).map((row) => row.id);
  phase = "HASH";
  let passwordHash;
  try { const { hash } = await import("@node-rs/argon2"); passwordHash = await hash(randomBytes(32).toString("hex")); }
  catch { throw new Error("QA_PASSWORD_HASH_FAILED"); }
  let second = { currency: "BYN", cashAccountId: IDS.cashByn, rate: "1.000000", rateDate: null,
    bynAmount: "1000.00", projectAmount: "1000.00" }, fxProof;
  if (mode === "USD") {
    phase = "FX";
    const day = new Date().toISOString().slice(0, 10);
    const url = new URL("https://api.nbrb.by/exrates/rates/USD"); url.searchParams.set("parammode", "2"); url.searchParams.set("ondate", day);
    let response;
    try { response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error("NBRB_RATE_UNAVAILABLE_CHOOSE_FALLBACK"); }
    check(response.ok, "NBRB_RATE_UNAVAILABLE_CHOOSE_FALLBACK");
    let raw, data;
    try { raw = await response.text(); data = JSON.parse(raw); }
    catch { throw new Error("NBRB_RESPONSE_INVALID_CHOOSE_FALLBACK"); }
    const rate = Math.round((Number(data?.Cur_OfficialRate) / Number(data?.Cur_Scale)) * 1e6) / 1e6;
    check(Number.isFinite(rate) && rate > 0 && typeof data?.Date === "string" && data.Date.slice(0, 10) === day,
      "NBRB_RATE_INVALID_CHOOSE_FALLBACK");
    fxProof = { source: "NBRB", rate: rate.toFixed(6), date: data.Date.slice(0, 10), rawSha256: sha(raw) };
    second = { currency: "USD", cashAccountId: IDS.cashUsd, rate: fxProof.rate, rateDate: fxProof.date,
      bynAmount: bynForUsd(fxProof.rate), projectAmount: bynForUsd(fxProof.rate) };
  }
  const marker = `QA-CASH ${IDS.runId}`;
  phase = "PLAN_VALIDATE";
  const plan = { format: "pero-cash-owned-qa/v1", runId: IDS.runId, target: LOCAL,
    schema: { tables: context.attestation.schemaTables, hash: context.attestation.schemaHash,
      optionalCompositionTables: context.attestation.optionalCompositionTables },
    migration: "20260929120000_manager_cash_advances", sqlSha256: SQL_SHA,
    baseline: cashRawFingerprints(snapshot, context.attestation.schemaTables), mode, fxProof,
    actors: { managerId: manager.id, financeId: finance.id, financeRecipientIds },
    project: { id: IDS.project, number: `QA-CASH-${IDS.runId}`, numberInt: -2147483001,
      title: marker, clientId: selection.clientId, managerId: manager.id, stage: "LEAD", currency: "BYN" },
    users: [true, false].map((active, index) => ({ id: index ? IDS.inactiveUser : IDS.activeUser,
      email: `${IDS.runId}-${index}@qa.invalid`, name: `${marker} ${index}`, roles: ["WORKER"], active,
      payScheme: "NONE", passwordHash, passwordDigest: sha(passwordHash) })),
    accounts: [{ id: IDS.cashByn, name: `${marker} BYN`, currency: "BYN", active: true },
      { id: IDS.cashUsd, name: `${marker} USD`, currency: "USD", active: true }],
    payments: [{ id: IDS.paymentByn, projectId: IDS.project, cashAccountId: IDS.cashByn, direction: "INCOME",
      amount: "1000.00", currency: "BYN", rate: "1.000000", rateDate: null, bynAmount: "1000.00",
      projectAmount: "1000.00", createdById: finance.id, comment: `${marker} funding 1` },
    { id: IDS.paymentOther, projectId: IDS.project, direction: "INCOME", amount: "1000.00",
      ...second, createdById: finance.id, comment: `${marker} funding 2` }],
    accrual: { id: IDS.accrual, userId: IDS.inactiveUser, amount: "500.00", currency: "BYN",
      scheme: "PIECE", month: priorMonth(), taskId: null, productId: null, settlementShareId: null,
      comment: `${marker} prior accrual` },
    requestIds: { advance: IDS.advanceRequest, salary: IDS.salaryRequest, usd: IDS.usdRequest, delete: IDS.deleteRequest } };
  validateCashQaPlan(plan);
  const planSha256 = cashPlanSha256(plan);
  if (diagnostic) return { status: "READ_ONLY_PLAN_DIAGNOSIS_PASS", planSha256, mode,
    source: mode === "USD" ? "NBRB_LIVE_QUOTE" : "EXPLICIT_BYN_FALLBACK", durablePlanWritten: false };
  phase = "SAVE";
  const file = savePrivate(dirname(prestartPath), "plan.json", plan);
  return { status: "PLAN_SAVED_REVIEW_REQUIRED", planFile: file, planSha256, mode, initialRows: 8, target: LOCAL.kind };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/^[A-Z0-9_]+$/.test(message)) throw error;
    throw new Error(`PLAN_DIAG_${phase}_${error instanceof Error ? error.name.toUpperCase() : "UNKNOWN"}`);
  }
}

export async function withCashQaContext(context, operation) {
  try { return await operation(context); }
  finally { await context.prisma.$disconnect(); }
}

async function executeLocal(request) {
  const [migrationPath] = request.paths;
  if (["prepare", "cleanup"].includes(request.operation)) {
    const planFile = privatePath(request.paths[1], "pero-cash-qa-local-", "plan.json");
    assertCashAttemptVacant(readdirSync(dirname(planFile)), request.operation);
  }
  if (request.operation === "remaining-local") {
    const planFile = privatePath(request.paths[1], "pero-cash-qa-local-", "plan.json");
    const kind = request.paths[3], names = readdirSync(dirname(planFile));
    check(["salary200", "usd50", "delete10", "remove10", "replay10"].includes(kind), "REMAINING_ACTION_FORBIDDEN");
    check(![`${kind}-intent.json`, `${kind}-intent.json.sha.json`, `${kind}-result.json`, `${kind}-result.json.sha.json`]
      .some((name) => names.includes(name)), "PRIOR_ACTION_ATTEMPT_REVIEW_REQUIRED");
  }
  const context = await localContext(migrationPath);
  return withCashQaContext(context, async () => {
    if (request.operation === "prestart") {
      const current = await migrationHashes(context.prisma, context.attestation.schemaTables);
      check(same(current, context.evidence.applied.after.hashes), "MIGRATION_TO_PRESTART_DRIFT");
      const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
      const directory = privateDirectory();
      const receipt = { runId: IDS.runId, targetIdentity: context.target.identity, schemaHash: context.attestation.schemaHash,
        schemaTables: context.attestation.schemaTables, fingerprints: cashRawFingerprints(snapshot, snapshot.schemaTables),
        pluginRows: snapshot.rows.Plugin, migrationHashes: current, migrationReceiptSha256: context.evidence.receiptSha256,
        madeAt: new Date().toISOString() };
      return { status: "PRESTART_SAVED", prestartFile: savePrivate(directory, "prestart.json", receipt), tables: snapshot.schemaTables.length };
    }
    if (request.operation === "refs-local" || request.operation === "select-local") {
      const prestartPath = request.paths[1], snapshot = await poststartSnapshot(context, prestartPath);
      assertCashHookSafety(snapshot);
      const refs = cashQaEligibleRefs(snapshot);
      if (request.operation === "refs-local") return { status: "READ_ONLY_REFS", ...refs };
      const [managerId, financeId, clientId] = request.paths.slice(2);
      check(refs.managers.some((row) => row.id === managerId) && refs.finance.some((row) => row.id === financeId) &&
        refs.clientIds.includes(clientId), "ACTOR_OR_CLIENT_FORBIDDEN");
      const file = savePrivate(dirname(prestartPath), "selection.json", { managerId, financeId, clientId });
      return { status: "SELECTION_SAVED", selectionFile: file, managerId, financeId, clientId };
    }
    if (["plan-local", "diagnose-plan-local"].includes(request.operation))
      return planLocal(context, request.paths[1], request.paths[2], request.paths[3], request.operation === "diagnose-plan-local");
    if (request.operation === "approve-local") {
      const plan = readPrivate(request.paths[1], "pero-cash-qa-local-", "plan.json");
      const actualSha256 = cashPlanSha256(plan);
      check(request.paths[2] === actualSha256 && same(plan.target, LOCAL) && plan.sqlSha256 === SQL_SHA &&
        plan.schema.hash === context.attestation.schemaHash, "PLAN_REVIEW_HASH_MISMATCH");
      const approval = { source: "owner-reviewed", planSha256: actualSha256, sqlSha256: SQL_SHA,
        targetKind: LOCAL.kind, approvedAt: new Date().toISOString() };
      return { status: "APPROVAL_SAVED", approvalFile: savePrivate(dirname(request.paths[1]), "approval.json", approval),
        planSha256: actualSha256 };
    }
    const plan = readPrivate(request.paths[1], "pero-cash-qa-local-", "plan.json");
    const approval = readPrivate(request.paths[2], "pero-cash-qa-local-", "approval.json");
    check(same(plan.target, LOCAL) && approval.source === "owner-reviewed" && approval.planSha256 === cashPlanSha256(plan) &&
      approval.sqlSha256 === SQL_SHA && approval.targetKind === LOCAL.kind, "DURABLE_APPROVED_PLAN_REQUIRED");
    if (request.operation === "approve-usd-exception") {
      check(request.paths[3] === approval.planSha256 && plan.mode === "USD", "LOCAL_EXCEPTION_PLAN_HASH_MISMATCH");
      const directory = dirname(request.paths[1]);
      const refusal = readPrivate(join(directory, "usd50-refusal-proof.json"), "pero-cash-qa-local-", "usd50-refusal-proof.json");
      const preview = readPrivate(join(directory, "fx-preview-result.json"), "pero-cash-qa-local-", "fx-preview-result.json");
      const observed = readPrivate(join(directory, "observed-salary200.json"), "pero-cash-qa-local-", "observed-salary200.json");
      const salaryCapture = readPrivate(join(directory, "captured-salary200.json"), "pero-cash-qa-local-", "captured-salary200.json");
      const fresh = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
        durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
        attestation: context.attestation, observed, phase: salaryCapture.phase });
      check(same(fresh, salaryCapture) && refusal.graphHash === salaryCapture.graphHash &&
        preview.noMoneyWrite === true && preview.graphHash === salaryCapture.graphHash &&
        ["FX_PREVIEW_REFUSED", "FX_PREVIEW_TRANSPORT_FAILED"].includes(preview.status),
      "LOCAL_EXCEPTION_REFUSAL_DRIFT");
      const exception = { source: "owner-explicit-local-vpn-exception", targetKind: LOCAL.kind,
        planSha256: approval.planSha256, refusalGraphHash: refusal.graphHash,
        expectedFunctional: expectedCashQaFinal(plan, true), approvedAt: new Date().toISOString() };
      assertLocalUsdException(plan, exception, refusal, salaryCapture);
      const file = savePrivate(directory, "local-usd-exception.json", exception);
      return { status: "LOCAL_EXCEPTION_RECORDED", file, expectedFunctional: exception.expectedFunctional };
    }
    if (request.operation === "readonly-browser-local") {
      const directory = dirname(request.paths[1]);
      const exception = readPrivate(join(directory, "local-usd-exception.json"), "pero-cash-qa-local-", "local-usd-exception.json");
      const refusal = readPrivate(join(directory, "usd50-refusal-proof.json"), "pero-cash-qa-local-", "usd50-refusal-proof.json");
      const salary = readPrivate(join(directory, "captured-salary200.json"), "pero-cash-qa-local-", "captured-salary200.json");
      assertLocalUsdException(plan, exception, refusal, salary);
      const observed = readPrivate(join(directory, "observed-local-exception.json"), "pero-cash-qa-local-", "observed-local-exception.json");
      const captured = readPrivate(join(directory, "captured-local-exception.json"), "pero-cash-qa-local-", "captured-local-exception.json");
      const captureCurrent = () => runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
        durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
        attestation: context.attestation, observed, phase: "PARTIAL" });
      check(captured.phase === "PARTIAL" && same(captured.functional, exception.expectedFunctional) &&
        same(await captureCurrent(), captured), "READONLY_BROWSER_BASELINE_DRIFT");
      savePrivate(directory, "cash-readonly-wrapper-before.json", { runId: IDS.runId,
        graphHash: captured.graphHash, phase: captured.phase, at: new Date().toISOString() });
      const build = inspectCashLocalBuild();
      const prestart = readPrivate(join(directory, "prestart.json"), "pero-cash-qa-local-", "prestart.json");
      const started = JSON.parse(readFileSync(join(directory, "runtime-started.json"), "utf8"));
      const secretDoc = JSON.parse(readFileSync(join(directory, "auth-secret.json"), "utf8"));
      assertCashRuntimeBinding(started, build, prestart, secretDoc, existsSync(join(directory, "runtime-stopped.json")));
      const secretBytes = Buffer.from(secretDoc.value ?? "", "base64");
      check(secretBytes.length >= 32 && sha(secretBytes) === secretDoc.digest, "RUNTIME_SECRET_DRIFT");
      const secret = secretBytes.toString("base64"); secretBytes.fill(0);
      const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
      const users = snapshot.rows.User.map((raw) => JSON.parse(raw));
      const ids = [plan.actors.managerId, plan.actors.financeId, plan.users[0].id];
      const actors = ids.map((id, index) => users.find((row) => row.id === id && row.active &&
        Number.isSafeInteger(row.sessionVersion) && (index === 2 ? same(row.roles, ["WORKER"]) :
          row.roles.some((role) => (index ? ["ADMIN", "DIRECTOR", "ACCOUNTANT"] :
            ["ADMIN", "DIRECTOR", "MANAGER"]).includes(role)))));
      check(actors.every(Boolean), "READONLY_BROWSER_ACTOR_DRIFT");
      const { encode } = await import("@auth/core/jwt");
      const roles = ["manager", "finance", "worker"];
      const sessions = { origin: "http://127.0.0.1:3106", sessions: await Promise.all(actors.map(async (row, index) => ({
        role: roles[index], userId: row.id, cookie: { name: "authjs.session-token",
          value: await encode({ token: { id: row.id, roles: row.roles, sessionVersion: row.sessionVersion },
            secret, salt: "authjs.session-token", maxAge: 900 }), domain: "127.0.0.1", path: "/",
          httpOnly: true, secure: false, sameSite: "Lax" } }))) };
      const manifestBytes = readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"));
      check(sha(manifestBytes) === build.manifestSha256, "READONLY_BROWSER_MANIFEST_DRIFT");
      const { runCashReadonlyBrowser } = await import("./cash-readonly-browser.mjs");
      let result;
      try { result = await runCashReadonlyBrowser({ baseUrl: sessions.origin, plan, sessions,
        serverReferenceManifest: JSON.parse(manifestBytes.toString("utf8")), outputDir: directory }); }
      finally {
        const after = await captureCurrent();
        savePrivate(directory, "cash-readonly-wrapper-after.json", { runId: IDS.runId,
          graphHash: after.graphHash, sameAsBefore: same(after, captured), phase: after.phase,
          at: new Date().toISOString() });
        check(same(after, captured), "READONLY_BROWSER_FOREIGN_DRIFT");
      }
      return { status: result.status, graphHash: captured.graphHash, screenshots: result.screenshots.length };
    }
    if (request.operation === "fx-preview-local") {
      const directory = dirname(request.paths[1]);
      const refusal = readPrivate(join(directory, "usd50-refusal-proof.json"), "pero-cash-qa-local-", "usd50-refusal-proof.json");
      check(refusal.status === "EXPLICIT_FX_REFUSAL_NO_WRITE" && refusal.runId === IDS.runId &&
        refusal.requestId === plan.requestIds.usd, "FX_REFUSAL_PROOF_REQUIRED");
      const priorObserved = readPrivate(join(directory, "observed-salary200.json"), "pero-cash-qa-local-", "observed-salary200.json");
      const priorCaptured = readPrivate(join(directory, "captured-salary200.json"), "pero-cash-qa-local-", "captured-salary200.json");
      const baseline = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
        durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
        attestation: context.attestation, observed: priorObserved, phase: priorCaptured.phase });
      check(same(baseline, priorCaptured), "FX_PROBE_BASELINE_DRIFT");
      const startedFile = join(directory, "runtime-started.json"), secretFile = join(directory, "auth-secret.json");
      const started = JSON.parse(readFileSync(startedFile, "utf8")), secretDoc = JSON.parse(readFileSync(secretFile, "utf8"));
      const prestart = readPrivate(join(directory, "prestart.json"), "pero-cash-qa-local-", "prestart.json");
      const build = inspectCashLocalBuild();
      assertCashRuntimeBinding(started, build, prestart, secretDoc, existsSync(join(directory, "runtime-stopped.json")));
      const secretBytes = Buffer.from(secretDoc.value ?? "", "base64");
      check(secretBytes.length >= 32 && sha(secretBytes) === secretDoc.digest, "RUNTIME_SECRET_DRIFT");
      const secret = secretBytes.toString("base64"); secretBytes.fill(0);
      const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
      const manager = snapshot.rows.User.map((raw) => JSON.parse(raw)).find((row) => row.id === plan.actors.managerId &&
        row.active && Number.isSafeInteger(row.sessionVersion) && row.roles.some((role) => ["MANAGER", "ADMIN", "DIRECTOR"].includes(role)));
      check(manager, "RUNTIME_ACTOR_DRIFT");
      const manifestBytes = readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"));
      check(sha(manifestBytes) === build.manifestSha256, "ACTION_MANIFEST_DRIFT");
      const { cashActionIds } = await import("./cash-qa-browser.mjs");
      const actionId = cashActionIds(JSON.parse(manifestBytes.toString("utf8"))).previewCashPayout;
      const { encode } = await import("@auth/core/jwt");
      const cookie = `authjs.session-token=${await encode({ token: { id: manager.id, roles: manager.roles,
        sessionVersion: manager.sessionVersion }, secret, salt: "authjs.session-token", maxAge: 900 })}`;
      const intent = { kind: "fx-preview", role: "manager", path: "/advances", action: "previewCashPayout",
        args: [{ cashAccountId: plan.accounts[1].id, cashAmount: "50.00", expectedCashCurrency: "USD" }] };
      savePrivate(directory, "fx-preview-intent.json", { runId: IDS.runId, requestSha256: sha(JSON.stringify(intent.args)),
        accountId: plan.accounts[1].id, planSha256: approval.planSha256, at: new Date().toISOString() });
      const { cashDirectActionOnce } = await import("./cash-local-actions.mjs");
      let response, transportError = null;
      try { response = await cashDirectActionOnce({ origin: "http://127.0.0.1:3106", intent, actionId, cookie }); }
      catch (error) { transportError = error instanceof Error ? error.message : "ACTION_UPSTREAM_UNCERTAIN"; }
      const after = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
        durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
        attestation: context.attestation, observed: priorObserved, phase: priorCaptured.phase });
      check(same(after, priorCaptured), "FX_PREVIEW_MUTATED_BUSINESS_STATE");
      const status = transportError ? "FX_PREVIEW_TRANSPORT_FAILED" : response.outcome.ok ?
        "FX_PREVIEW_SUCCEEDED" : "FX_PREVIEW_REFUSED";
      const evidenceFile = savePrivate(directory, "fx-preview-result.json", { status, runId: IDS.runId,
        outcome: response?.outcome ?? null, transportError, responseSha256: response?.responseSha256 ?? null,
        graphHash: after.graphHash, noMoneyWrite: true });
      return { status, evidenceFile, noMoneyWrite: true };
    }
    if (["remaining-local", "capture-remaining", "inspect-uncertain"].includes(request.operation)) {
      const { cashRemainingIntent, cashDeleteIntent, cashDirectActionOnce, cashResultRecord,
        recoverRecordedSalaryResult, assertCashUsdRefusalRecorded } = await import("./cash-local-actions.mjs");
      const { cashRemainingPredecessor, assertCashDeleteOwnership, deriveCashProgress } = await import("./cash-local-progress.mjs");
      const kind = request.paths[3], directory = dirname(request.paths[1]);
      const localUsdException = existsSync(join(directory, "local-usd-exception.json"));
      if (localUsdException) {
        const exception = readPrivate(join(directory, "local-usd-exception.json"), "pero-cash-qa-local-", "local-usd-exception.json");
        const refusal = readPrivate(join(directory, "usd50-refusal-proof.json"), "pero-cash-qa-local-", "usd50-refusal-proof.json");
        const salary = readPrivate(join(directory, "captured-salary200.json"), "pero-cash-qa-local-", "captured-salary200.json");
        assertLocalUsdException(plan, exception, refusal, salary);
      }
      const preceding = cashRemainingPredecessor(plan, kind, localUsdException);
      const priorObserved = readPrivate(join(directory, `observed-${preceding}.json`), "pero-cash-qa-local-", `observed-${preceding}.json`);
      const priorCaptured = readPrivate(join(directory, `captured-${preceding}.json`), "pero-cash-qa-local-", `captured-${preceding}.json`);
      if (request.operation === "remaining-local") {
        const freshPrior = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
          durablePlanSha256: approval.planSha256, approval, prisma: context.prisma, attestation: context.attestation,
          observed: priorObserved, phase: priorCaptured.phase });
        check(same(freshPrior, priorCaptured), "PRIOR_CAPTURE_DRIFT");
      }
      if (request.operation === "capture-remaining") {
        const intentProof = readPrivate(join(directory, `${kind}-intent.json`), "pero-cash-qa-local-", `${kind}-intent.json`);
        const resultPath = join(directory, `${kind}-result.json`);
        const recorded = readPrivate(resultPath, "pero-cash-qa-local-", `${kind}-result.json`);
        const result = kind === "salary200" && typeof recorded.status === "number" ?
          recoverRecordedSalaryResult(recorded, sha(readFileSync(resultPath))) : recorded;
        check(result.status === "ACTION_RESPONSE_CAPTURED" && result.kind === kind &&
          intentProof.kind === kind && intentProof.planSha256 === approval.planSha256 &&
          intentProof.payloadSha256 === result.requestSha256, "ACTION_RESULT_NOT_CONFIRMED");
        const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
        const observed = deriveCashProgress(snapshot, plan, priorObserved, kind, result);
        const phase = kind === "replay10" && !localUsdException ? "FINAL" : "PARTIAL";
        if (kind === "replay10") observed.functional = expectedCashQaFinal(plan, localUsdException);
        const captured = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
          durablePlanSha256: approval.planSha256, approval, prisma: context.prisma, attestation: context.attestation,
          observed, phase });
        if (kind === "replay10" && localUsdException)
          check(same(captured.functional, observed.functional), "LOCAL_EXCEPTION_BALANCE_MISMATCH");
        const suffix = kind === "replay10" ? (localUsdException ? "local-exception" : "final") : kind;
        const observedFile = savePrivate(directory, `observed-${suffix}.json`, observed);
        const capturedFile = savePrivate(directory, `captured-${suffix}.json`, captured);
        if (kind === "replay10") savePrivate(directory, "remaining-drained.json", { runId: IDS.runId,
          actionsDrained: true, capturedGraphHash: captured.graphHash,
          kinds: ["salary200", ...(plan.mode === "USD" && !localUsdException ? ["usd50"] : []),
            "delete10", "remove10", "replay10"], localUsdException,
          refusedRequestId: localUsdException ? plan.requestIds.usd : null });
        return { status: kind === "replay10" ? (localUsdException ? "LOCAL_EXCEPTION_CAPTURED" : "FINAL_CAPTURED") :
          "PARTIAL_CAPTURED", kind,
          observedFile, capturedFile, graphHash: captured.graphHash };
      }
      if (request.operation === "inspect-uncertain") {
        const intentProof = readPrivate(join(directory, `${kind}-intent.json`), "pero-cash-qa-local-", `${kind}-intent.json`);
        check(intentProof.kind === kind && intentProof.planSha256 === approval.planSha256, "UNCERTAIN_INSPECTION_NOT_APPLICABLE");
        const resultExists = existsSync(join(directory, `${kind}-result.json`));
        if (resultExists) {
          check(kind === "usd50", "UNCERTAIN_INSPECTION_NOT_APPLICABLE");
          const refusal = readPrivate(join(directory, "usd50-result.json"), "pero-cash-qa-local-", "usd50-result.json");
          assertCashUsdRefusalRecorded(intentProof, refusal);
          const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
          check(!snapshot.rows.ChangeLog.some((raw) => JSON.parse(raw).id === `payout-issue:${plan.requestIds.usd}`),
            "USD_REFUSAL_RECEIPT_UNEXPECTED");
          const fresh = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
            durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
            attestation: context.attestation, observed: priorObserved, phase: priorCaptured.phase });
          check(same(fresh, priorCaptured), "USD_REFUSAL_DATABASE_DRIFT");
          const evidenceFile = savePrivate(directory, "usd50-refusal-proof.json", {
            status: "EXPLICIT_FX_REFUSAL_NO_WRITE", runId: IDS.runId, requestId: plan.requestIds.usd,
            responseSha256: refusal.responseSha256, graphHash: fresh.graphHash, noRetry: true });
          return { status: "EXPLICIT_FX_REFUSAL_NO_WRITE", evidenceFile, noRetry: true };
        }
        const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
        const receiptId = `payout-issue:${kind === "salary200" ? plan.requestIds.salary :
          kind === "usd50" ? plan.requestIds.usd : plan.requestIds.delete}`;
        const receipt = snapshot.rows.ChangeLog.map((raw) => JSON.parse(raw)).find((row) => row.id === receiptId);
        let status, observed = priorObserved, phase = priorCaptured.phase;
        if (["salary200", "usd50", "delete10"].includes(kind) && receipt) {
          observed = deriveCashProgress(snapshot, plan, priorObserved, kind,
            { kind, outcome: { ok: true, payoutId: receipt.entityId, repeated: false } });
          phase = "PARTIAL"; status = "COMMITTED_LEDGER_WITHOUT_RESPONSE";
        } else if (kind === "remove10") {
          const target = priorObserved.outcomes.find((row) => row.requestId === plan.requestIds.delete);
          const deleted = target && !snapshot.rows.Payout.some((raw) => JSON.parse(raw).id === target.payoutId);
          if (deleted) { observed = deriveCashProgress(snapshot, plan, priorObserved, kind,
            { kind, outcome: { ok: true } }); phase = "PARTIAL"; status = "DELETE_COMMITTED_WITHOUT_RESPONSE"; }
          else status = "NO_DELETE_OBSERVED";
        } else if (kind === "replay10") status = "REPLAY_RESPONSE_UNKNOWN_NO_NEW_WRITE_ALLOWED";
        else status = "NO_ISSUE_RECEIPT_OBSERVED";
        const captured = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
          durablePlanSha256: approval.planSha256, approval, prisma: context.prisma, attestation: context.attestation,
          observed, phase });
        const evidenceFile = savePrivate(directory, `uncertain-${kind}.json`, { status, kind,
          capture: captured, responseKnown: false, noAutoRetry: true });
        return { status, evidenceFile, noAutoRetry: true };
      }
      const build = inspectCashLocalBuild(), prestart = readPrivate(join(directory, "prestart.json"),
        "pero-cash-qa-local-", "prestart.json");
      const state = (name) => {
        const file = join(directory, name);
        check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "RUNTIME_STATE_MISSING");
        return JSON.parse(readFileSync(file, "utf8"));
      };
      const started = state("runtime-started.json"), secretDoc = state("auth-secret.json");
      assertCashRuntimeBinding(started, build, prestart, secretDoc, existsSync(join(directory, "runtime-stopped.json")));
      const secretBytes = Buffer.from(secretDoc.value ?? "", "base64");
      check(secretBytes.length >= 32 && sha(secretBytes) === secretDoc.digest, "RUNTIME_SECRET_DRIFT");
      const secret = secretBytes.toString("base64"); secretBytes.fill(0);
      const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
      const users = snapshot.rows.User.map((raw) => JSON.parse(raw));
      const financeAction = ["salary200", "remove10"].includes(kind);
      const actorId = financeAction ? plan.actors.financeId : plan.actors.managerId;
      const actor = users.find((row) => row.id === actorId && row.active && Number.isSafeInteger(row.sessionVersion) &&
        row.roles.some((role) => (financeAction ? ["ADMIN", "DIRECTOR", "ACCOUNTANT"] : ["ADMIN", "DIRECTOR", "MANAGER"]).includes(role)));
      check(actor, "RUNTIME_ACTOR_DRIFT");
      const ownedDeleteId = kind === "remove10" ? assertCashDeleteOwnership(snapshot, plan, priorObserved) : null;
      const intent = kind === "remove10" ? cashDeleteIntent(ownedDeleteId) :
        cashRemainingIntent(plan, kind === "replay10" ? "delete10" : kind, new Date().toISOString().slice(0, 7));
      if (kind === "replay10") intent.kind = "replay10";
      const manifestBytes = readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"));
      check(sha(manifestBytes) === build.manifestSha256, "ACTION_MANIFEST_DRIFT");
      const { cashActionIds } = await import("./cash-qa-browser.mjs");
      const actionId = cashActionIds(JSON.parse(manifestBytes.toString("utf8")))[intent.action];
      const { encode } = await import("@auth/core/jwt");
      const cookie = `authjs.session-token=${await encode({ token: { id: actor.id, roles: actor.roles,
        sessionVersion: actor.sessionVersion }, secret, salt: "authjs.session-token", maxAge: 900 })}`;
      savePrivate(directory, `${kind}-intent.json`, { kind, actorId, requestId: intent.args[0]?.requestId ?? null,
        payoutId: kind === "remove10" ? intent.args[0] : null, planSha256: approval.planSha256,
        payloadSha256: sha(JSON.stringify(intent.args)), at: new Date().toISOString() });
      const result = await cashDirectActionOnce({ origin: "http://127.0.0.1:3106", intent, actionId, cookie });
      const valid = kind === "replay10" ? result.outcome.ok === false &&
        typeof result.outcome.error === "string" && result.outcome.error.includes("отменена") :
        kind === "remove10" ? result.outcome.ok === true :
          result.outcome.ok === true && result.outcome.repeated === false && typeof result.outcome.payoutId === "string";
      const resultFile = savePrivate(directory, `${kind}-result.json`, cashResultRecord({ kind, ...result }, valid));
      check(valid, "UNEXPECTED_ACTION_RESPONSE_CAPTURE_REQUIRED");
      return { status: "ACTION_RESPONSE_CAPTURED", kind, resultFile, payoutId: result.outcome.payoutId ?? null };
    }
    if (request.operation === "capture-advance") {
      const directory = dirname(request.paths[1]);
      const drained = readPrivate(join(directory, "cash-browser-drained.json"), "pero-cash-qa-local-", "cash-browser-drained.json");
      const browserResult = readPrivate(join(directory, "cash-browser-result.json"), "pero-cash-qa-local-", "cash-browser-result.json");
      check(drained.runId === plan.runId && drained.target === LOCAL.kind && drained.actionsDrained === true &&
        drained.contextsClosed === true && drained.inFlight === 0 && drained.uncertain === false &&
        !existsSync(join(directory, "cash-browser-stop.json")), "BROWSER_ACTION_NOT_DRAINED");
      const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
      const observed = deriveCashAdvanceObserved(snapshot, plan, browserResult);
      const captured = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
        durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
        attestation: context.attestation, observed, phase: "PARTIAL" });
      const observedFile = savePrivate(directory, "observed-advance.json", observed);
      const capturedFile = savePrivate(directory, "captured-advance.json", captured);
      return { status: "ADVANCE_CAPTURED", observedFile, capturedFile, graphHash: captured.graphHash };
    }
    if (request.operation === "browser-local") {
      const prestart = readPrivate(request.paths[3], "pero-cash-qa-local-", "prestart.json");
      const initial = readPrivate(request.paths[4], "pero-cash-qa-local-", "captured-initial.json");
      const directory = dirname(request.paths[1]);
      check(dirname(request.paths[3]) === directory && dirname(request.paths[4]) === directory &&
        initial.phase === "INITIAL", "BROWSER_INITIAL_PROOF_REQUIRED");
      const fresh = await runCashNativeAcceptance({ args: ["--execute", "capture"], plan,
        durablePlanSha256: approval.planSha256, approval, prisma: context.prisma,
        attestation: context.attestation, observed: { outcomes: [], effectIds: {} }, phase: "INITIAL" });
      check(same(fresh, initial), "INITIAL_CAPTURE_DRIFT");
      const build = inspectCashLocalBuild();
      const stateFile = (name) => {
        const file = join(directory, name);
        check(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "RUNTIME_STATE_MISSING");
        return JSON.parse(readFileSync(file, "utf8"));
      };
      const started = stateFile("runtime-started.json"), secretDoc = stateFile("auth-secret.json");
      assertCashRuntimeBinding(started, build, prestart, secretDoc, existsSync(join(directory, "runtime-stopped.json")));
      const secretBytes = Buffer.from(secretDoc.value ?? "", "base64");
      check(secretBytes.length >= 32 && sha(secretBytes) === secretDoc.digest, "RUNTIME_SECRET_DRIFT");
      const secret = secretBytes.toString("base64"); secretBytes.fill(0);
      const snapshot = await snapshotAdapter(context).readOnly((tx) => tx.snapshot());
      const users = snapshot.rows.User.map((raw) => JSON.parse(raw));
      const actor = (id, roles) => users.find((row) => row.id === id && row.active && Number.isSafeInteger(row.sessionVersion) &&
        row.roles.some((role) => roles.includes(role)));
      const manager = actor(plan.actors.managerId, ["ADMIN", "DIRECTOR", "MANAGER"]);
      const finance = actor(plan.actors.financeId, ["ADMIN", "DIRECTOR", "ACCOUNTANT"]);
      check(manager && finance, "RUNTIME_ACTOR_DRIFT");
      const { encode } = await import("@auth/core/jwt");
      const cookie = async (role, row) => ({ role, userId: row.id, cookie: {
        name: "authjs.session-token", value: await encode({ token: { id: row.id, roles: row.roles,
          sessionVersion: row.sessionVersion }, secret, salt: "authjs.session-token", maxAge: 900 }),
        domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" } });
      const sessions = { origin: "http://127.0.0.1:3106", sessions: [await cookie("manager", manager),
        await cookie("finance", finance)] };
      const manifestBytes = readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"));
      check(sha(manifestBytes) === build.manifestSha256, "BROWSER_MANIFEST_DRIFT");
      const { runCashQaBrowser } = await import("./cash-qa-browser.mjs");
      return runCashQaBrowser({ baseUrl: sessions.origin, plan, sessions,
        serverReferenceManifest: JSON.parse(manifestBytes.toString("utf8")), outputDir: directory });
    }
    let operation = request.operation, observed, phase, captured, durableCaptureSha256, actionsDrained;
    if (operation === "capture") {
      observed = readPrivate(request.paths[3], "pero-cash-qa-local-", "observed.json"); phase = request.paths[4];
    }
    if (operation === "cleanup") {
      const directory = dirname(request.paths[1]);
      const localUsdException = existsSync(join(directory, "local-usd-exception.json"));
      const suffix = localUsdException ? "local-exception" : "final";
      check(request.paths[3] === join(directory, `observed-${suffix}.json`) &&
        request.paths[4] === join(directory, `captured-${suffix}.json`) &&
        request.paths[5] === join(directory, "cash-browser-drained.json"), "CLEANUP_EVIDENCE_PATH_MISMATCH");
      observed = readPrivate(request.paths[3], "pero-cash-qa-local-", `observed-${suffix}.json`);
      captured = readPrivate(request.paths[4], "pero-cash-qa-local-", `captured-${suffix}.json`);
      if (localUsdException) {
        const exception = readPrivate(join(directory, "local-usd-exception.json"), "pero-cash-qa-local-", "local-usd-exception.json");
        const refusal = readPrivate(join(directory, "usd50-refusal-proof.json"), "pero-cash-qa-local-", "usd50-refusal-proof.json");
        const salary = readPrivate(join(directory, "captured-salary200.json"), "pero-cash-qa-local-", "captured-salary200.json");
        assertLocalUsdException(plan, exception, refusal, salary);
        check(captured.phase === "PARTIAL" && same(captured.functional, exception.expectedFunctional) &&
          same(observed.functional, exception.expectedFunctional), "LOCAL_EXCEPTION_CLEANUP_PROOF_INVALID");
      } else check(captured.phase === "FINAL", "FINAL_CAPTURE_REQUIRED");
      const drained = readPrivate(request.paths[5], "pero-cash-qa-local-", "cash-browser-drained.json");
      const remaining = readPrivate(join(directory, "remaining-drained.json"), "pero-cash-qa-local-", "remaining-drained.json");
      let readonlyDrained = true;
      if (existsSync(join(directory, "cash-readonly-started.json"))) {
        const proof = readPrivate(join(directory, "cash-readonly-drained.json"), "pero-cash-qa-local-", "cash-readonly-drained.json");
        const after = readPrivate(join(directory, "cash-readonly-wrapper-after.json"), "pero-cash-qa-local-", "cash-readonly-wrapper-after.json");
        readonlyDrained = proof.runId === IDS.runId && proof.actionsDrained === true &&
          proof.contextsClosed === true && proof.inFlight === 0 && after.runId === IDS.runId &&
          after.sameAsBefore === true && after.graphHash === captured.graphHash;
      }
      const started = JSON.parse(readFileSync(join(directory, "runtime-started.json"), "utf8"));
      const stopped = JSON.parse(readFileSync(join(directory, "runtime-stopped.json"), "utf8"));
      actionsDrained = drained.actionsDrained === true && drained.contextsClosed === true && drained.runId === IDS.runId &&
        remaining.actionsDrained === true && remaining.runId === IDS.runId &&
        remaining.capturedGraphHash === captured.graphHash && remaining.localUsdException === localUsdException &&
        readonlyDrained && stopped.pid === started.pid && stopped.requestedStop === true;
      durableCaptureSha256 = request.paths[6];
    }
    if (["prepare", "cleanup"].includes(operation)) {
      const directory = dirname(request.paths[1]);
      assertCashAttemptVacant(readdirSync(directory), operation);
      savePrivate(directory, `${operation}-intent.json`, { operation, runId: IDS.runId,
        planSha256: approval.planSha256, target: LOCAL, sourceHead: context.src.head,
        attestationSha256: context.attestation.proofSha256, at: new Date().toISOString() });
    }
    if (operation === "capture-initial") { operation = "capture"; observed = { outcomes: [], effectIds: {} }; phase = "INITIAL"; }
    const result = await runCashNativeAcceptance({ args: ["--execute", operation], plan, durablePlanSha256: approval.planSha256,
      approval, prisma: context.prisma, attestation: context.attestation, observed, phase, captured,
      durableCaptureSha256, actionsDrained });
    const name = operation === "prepare" ? "prepared.json" : operation === "capture" ?
      (phase === "INITIAL" ? "captured-initial.json" : "captured.json") :
      operation === "cleanup" ? "cleaned.json" : `${operation}.json`;
    const output = savePrivate(dirname(request.paths[1]), name, result);
    return { status: "EVIDENCE_SAVED", operation, evidenceFile: output };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  runCashQaRunner({ args: process.argv.slice(2), runtime: { execute: executeLocal } }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    const code = error instanceof Error ? error.message : "";
    process.stderr.write(`${JSON.stringify({ status: "STOP", code: /^[A-Z0-9_]+$/.test(code) ? code : "PRIVATE_OUTPUT_REVIEW_REQUIRED" })}\n`);
    process.exitCode = 1;
  });
}
