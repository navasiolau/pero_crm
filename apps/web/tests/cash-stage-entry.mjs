/** Bundled, inert-on-import stage QA entry. Guest wrapper supplies verified W07/backup proof. */
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createCashQaSqlAdapter, probeCashQaDatabase } from "./cash-qa-adapter.mjs";
import { canonical, cashCaptureSha256, cashPlanSha256, cashRawFingerprints, validateCashQaPlan,
  prepareCashQa, captureCashQa, cleanupCashQa } from "./cash-owned-fixtures.mjs";
import { deriveCashProgress } from "./cash-local-progress.mjs";

const TARGET = Object.freeze({ kind: "EXISTING_STAGING",
  containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
  guest: "crm-staging", host: "db", port: 5432, database: "crm" });
const SQL_SHA = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd";
const MIGRATION = "20260929120000_manager_cash_advances";
const RUN_ID = "8d7055e1-560a-4c0d-969a-b2f6193deaa2";
const IDS = Object.freeze({ project: "eac09ada-aecc-44be-b159-1cf7de2cf00e",
  activeUser: "f7f65efa-8c95-42da-b5d7-6f878b68affc", inactiveUser: "722556c6-5784-4008-bfe0-ac0cfab5d777",
  cashByn: "994f8cb7-601c-48c3-8334-534ee859c0cf", cashUsd: "fc94ed3f-5fa6-4068-b291-6ab22b722be9",
  paymentByn: "8fe27073-70a1-4e90-a3d8-23a92de81f2d", paymentOther: "79d01c1c-e1b0-4c81-a473-c1b10038a565",
  accrual: "a44affe7-80ee-4e41-8320-6a2fdb46bb86", advance: "70d35482-e2c9-4429-b352-f85bd351a82b",
  salary: "e4f0897b-8b90-42a8-b929-b91062188cf5", usd: "d4b34f62-5db9-47e0-96f2-b482a8407d02",
  delete: "25d5e1ad-101c-405d-8f94-5dd6876c8c3b" });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => canonical(a) === canonical(b);
const check = (ok, code) => { if (!ok) throw new Error(code); };
const ORIGIN = "https://staging-crm.peromebel.by";

export function assertCashStageEnvironment(env, sqlBytes) {
  const url = new URL(env.DATABASE_URL ?? "");
  check(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "db" &&
    (!url.port || url.port === "5432") && url.pathname === "/crm" && decodeURIComponent(url.username) === "crm" &&
    url.password.length > 0 && !url.hash && (!url.search || url.search === "?schema=public") &&
    !env.DIRECT_URL && !env.NODE_OPTIONS && !env.NODE_PATH && sha(sqlBytes) === SQL_SHA,
  "STAGING_SOURCE_OR_DATABASE_BINDING_MISMATCH");
  return true;
}

export function assertCashStageBackup(backup) {
  check(backup?.verified === true && backup.targetKind === TARGET.kind && backup.database === TARGET.database &&
    [backup.archiveSha256, backup.tocSha256, backup.fullReadSha256].every((value) => /^[0-9a-f]{64}$/i.test(value ?? "")),
  "STAGING_BACKUP_PROOF_REQUIRED");
  return backup;
}

export function assertCashStageAbortApproval(plan, captured, approval) {
  check(["INITIAL", "PARTIAL"].includes(captured?.phase) &&
    approval?.source === "root-reviewed-abort" && approval.planSha256 === cashPlanSha256(plan) &&
    approval.captureSha256 === cashCaptureSha256(captured) && approval.graphHash === captured.graphHash &&
    approval.uncertainInspected === true, "STAGING_ABORT_APPROVAL_REQUIRED");
  return true;
}

function rows(snapshot, table) { return snapshot.rows[table].map((raw) => JSON.parse(raw)); }
export async function cashStageCookieProfile(user, role, secret, encode) {
  const names = ["__Secure-authjs.session-token", "authjs.session-token"];
  const cookies = await Promise.all(names.map(async (name) => ({ name,
    value: await encode({ token: { id: user.id, roles: user.roles, sessionVersion: user.sessionVersion },
      secret, salt: name, maxAge: 900 }),
    domain: "staging-crm.peromebel.by", path: "/", httpOnly: true, secure: true, sameSite: "Lax" })));
  return { role, userId: user.id, cookie: cookies[0], companionCookie: cookies[1] };
}
export function cashStageRefs(snapshot) {
  const users = rows(snapshot, "User"), plugins = rows(snapshot, "Plugin");
  const settings = rows(snapshot, "OrgSetting").filter((row) => row.key === "payrollCurrency");
  check(settings.length <= 1 && (!settings.length || settings[0].value === "BYN"), "STAGING_PAYROLL_CURRENCY_FORBIDDEN");
  check(plugins.every((row) => ["demo", "file-stages"].includes(row.id)) &&
    !plugins.some((row) => row.id === "demo" && row.enabled), "STAGING_PLUGIN_HOOK_UNATTRIBUTABLE");
  const select = (roles) => users.filter((row) => row.active && row.roles.some((role) => roles.includes(role)))
    .map((row) => ({ id: row.id, roles: row.roles })).sort((a, b) => a.id.localeCompare(b.id));
  return { managers: select(["ADMIN", "DIRECTOR", "MANAGER"]),
    finance: select(["ADMIN", "DIRECTOR", "ACCOUNTANT"]),
    clientIds: rows(snapshot, "Client").map((row) => row.id).sort() };
}

function byn1000(rateText) {
  const millionths = BigInt(rateText.replace(".", ""));
  const cents = (100000n * millionths + 500000n) / 1000000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function expectedStageFinal(plan) {
  check(plan.mode === "USD" && /^\d+\.\d{6}$/.test(plan.fxProof?.rate ?? ""), "STAGING_USD_FINAL_REQUIRED");
  const micro = BigInt(plan.fxProof.rate.replace(".", ""));
  const byn = (cents) => (cents * micro + 500000n) / 1000000n;
  const total = 100000n + byn(100000n) - 12000n - 20000n - byn(5000n);
  return { bynCash: "680.00", usdCash: "950.00", inactiveDue: "300.00",
    orgDeltaByn: `${total / 100n}.${String(total % 100n).padStart(2, "0")}` };
}

function observeAdvance(snapshot, plan, actionResult) {
  const payoutId = actionResult?.captured?.payoutId;
  check(actionResult?.status === "FORM_ADVANCE_CREATED" && actionResult.runId === plan.runId &&
    actionResult.captured.requestId === plan.requestIds.advance && typeof payoutId === "string", "STAGING_ADVANCE_RESULT_INVALID");
  const receipt = rows(snapshot, "ChangeLog").find((row) => row.id === `payout-issue:${plan.requestIds.advance}`);
  check(receipt?.entityId === payoutId && receipt.actorId === plan.actors.managerId &&
    receipt.newValue?.kind === "ADVANCE" && receipt.newValue?.userId === plan.users[0].id,
  "STAGING_ADVANCE_RECEIPT_INVALID");
  const events = rows(snapshot, "DomainEvent").filter((row) => row.type === "payroll.payout" &&
    row.payload?.payoutId === payoutId && row.actor === plan.actors.managerId);
  check(events.length === 1, "STAGING_ADVANCE_EVENT_INVALID");
  const expected = [`payroll.payout|${plan.users[0].id}`,
    ...plan.actors.financeRecipientIds.filter((id) => id !== plan.actors.managerId).map((id) => `payroll.orgPayout|${id}`)];
  const notices = rows(snapshot, "Notification").filter((row) => typeof row.body === "string" &&
    row.body.includes(`QA-CASH ${plan.runId} advance`) && expected.includes(`${row.type}|${row.userId}`));
  check(notices.length === expected.length &&
    same(notices.map((row) => `${row.type}|${row.userId}`).sort(), [...expected].sort()),
  "STAGING_ADVANCE_NOTIFICATIONS_INVALID");
  return { outcomes: [{ requestId: plan.requestIds.advance, payoutId, deleted: false }],
    effectIds: { DomainEvent: [events[0].id], Notification: notices.map((row) => row.id), ChangeLog: [] },
    duplicateReplay: true };
}

async function stagePlan(snapshot, facts, request) {
  const refs = cashStageRefs(snapshot), { managerId, financeId, clientId, mode } = request;
  check(refs.managers.some((row) => row.id === managerId) && refs.finance.some((row) => row.id === financeId) &&
    refs.clientIds.includes(clientId) && ["USD", "BYN_FALLBACK"].includes(mode), "STAGING_SELECTION_FORBIDDEN");
  const users = rows(snapshot, "User"), preferences = rows(snapshot, "NotificationPreference");
  const financeRecipientIds = users.filter((row) => row.active &&
    row.roles.some((role) => ["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(role)) &&
    preferences.find((p) => p.userId === row.id && p.type === "payroll.orgPayout")?.enabled !== false)
    .map((row) => row.id);
  const { hash } = await import("@node-rs/argon2");
  const password = randomBytes(32), passwordHash = await hash(password.toString("hex")); password.fill(0);
  const today = new Date().toISOString().slice(0, 10), marker = `QA-CASH ${RUN_ID}`;
  let second = { currency: "BYN", cashAccountId: IDS.cashByn, rate: "1.000000", rateDate: null,
    bynAmount: "1000.00", projectAmount: "1000.00" }, fxProof;
  if (mode === "USD") {
    const url = new URL("https://api.nbrb.by/exrates/rates/USD");
    url.searchParams.set("parammode", "2"); url.searchParams.set("ondate", today);
    let response, raw, data;
    try { response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      check(response.ok, "STAGING_NBRB_RATE_UNAVAILABLE"); raw = await response.text(); data = JSON.parse(raw); }
    catch { throw new Error("STAGING_NBRB_RATE_UNAVAILABLE"); }
    const rate = Math.round((Number(data?.Cur_OfficialRate) / Number(data?.Cur_Scale)) * 1e6) / 1e6;
    check(Number.isFinite(rate) && rate > 0 && data?.Date?.slice(0, 10) === today, "STAGING_NBRB_RATE_INVALID");
    fxProof = { source: "NBRB", rate: rate.toFixed(6), date: today, rawSha256: sha(raw) };
    second = { currency: "USD", cashAccountId: IDS.cashUsd, rate: fxProof.rate, rateDate: today,
      bynAmount: byn1000(fxProof.rate), projectAmount: byn1000(fxProof.rate) };
  }
  const priorMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const plan = { format: "pero-cash-owned-qa/v1", runId: RUN_ID, target: TARGET,
    schema: { tables: facts.schemaTables, hash: facts.schemaHash,
      optionalCompositionTables: facts.optionalCompositionTables },
    migration: MIGRATION, sqlSha256: SQL_SHA, baseline: cashRawFingerprints(snapshot, facts.schemaTables), mode, fxProof,
    actors: { managerId, financeId, financeRecipientIds },
    project: { id: IDS.project, number: `QA-CASH-${RUN_ID}`, numberInt: -2147483002,
      title: marker, clientId, managerId, stage: "LEAD", currency: "BYN" },
    users: [true, false].map((active, index) => ({ id: index ? IDS.inactiveUser : IDS.activeUser,
      email: `${RUN_ID}-${index}@qa.invalid`, name: `${marker} ${index}`, roles: ["WORKER"], active,
      payScheme: "NONE", passwordHash, passwordDigest: sha(passwordHash) })),
    accounts: [{ id: IDS.cashByn, name: `${marker} BYN`, currency: "BYN", active: true },
      { id: IDS.cashUsd, name: `${marker} USD`, currency: "USD", active: true }],
    payments: [{ id: IDS.paymentByn, projectId: IDS.project, cashAccountId: IDS.cashByn,
      direction: "INCOME", amount: "1000.00", currency: "BYN", rate: "1.000000", rateDate: null,
      bynAmount: "1000.00", projectAmount: "1000.00", createdById: financeId, comment: `${marker} funding 1` },
    { id: IDS.paymentOther, projectId: IDS.project, direction: "INCOME", amount: "1000.00",
      ...second, createdById: financeId, comment: `${marker} funding 2` }],
    accrual: { id: IDS.accrual, userId: IDS.inactiveUser, amount: "500.00", currency: "BYN",
      scheme: "PIECE", month: priorMonth, taskId: null, productId: null, settlementShareId: null,
      comment: `${marker} prior accrual` },
    requestIds: { advance: IDS.advance, salary: IDS.salary, usd: IDS.usd, delete: IDS.delete } };
  validateCashQaPlan(plan);
  return plan;
}

export async function executeCashStage(request, deps = {}) {
  check(request?.target === "staging" && ["refs", "plan", "prepare", "capture", "verify", "observe", "cleanup", "abort-cleanup", "sessions"].includes(request.operation),
  "STAGING_REQUEST_FORBIDDEN");
  const sqlFile = `/app/apps/web/prisma/migrations/${MIGRATION}/migration.sql`;
  assertCashStageEnvironment(process.env, readFileSync(sqlFile));
  const backup = assertCashStageBackup(request.backup);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = deps.prisma ?? new PrismaClient({ log: [] });
  try {
    const facts = await probeCashQaDatabase(prisma, TARGET, SQL_SHA);
    check(facts.dbUser === "crm", "STAGING_DATABASE_USER_MISMATCH");
    const attestation = { source: "verified-runner", target: TARGET, ...facts, verifiedAt: new Date().toISOString(),
      backup, proofSha256: sha(canonical({ target: TARGET, facts, backup })) };
    const plan = request.plan;
    const adapter = createCashQaSqlAdapter({ prisma, target: TARGET, attestation, plan,
      approvedCapture: request.captured, writeAuthorization: request.approval });
    let result;
    if (request.operation === "refs") result = cashStageRefs(await adapter.readOnly((tx) => tx.snapshot()));
    else if (request.operation === "plan") result = await stagePlan(await adapter.readOnly((tx) => tx.snapshot()), facts, request);
    else {
      validateCashQaPlan(plan);
      check(same(plan.target, TARGET) && request.approval?.source === "owner-reviewed" &&
        request.approval.planSha256 === cashPlanSha256(plan) && request.approval.sqlSha256 === SQL_SHA &&
        request.approval.targetKind === TARGET.kind, "STAGING_DURABLE_APPROVAL_REQUIRED");
      if (request.operation === "prepare") result = await prepareCashQa({ adapter, plan, durablePlanSha256: request.approval.planSha256 });
      else if (request.operation === "capture") result = await captureCashQa({ adapter, plan,
        observed: request.observed, phase: request.phase });
      else if (request.operation === "verify") {
        const fresh = await captureCashQa({ adapter, plan, observed: request.observed, phase: request.captured?.phase });
        check(same(fresh, request.captured), "STAGING_PRIOR_CAPTURE_DRIFT");
        result = { phase: fresh.phase, graphHash: fresh.graphHash, sameAsPrior: true };
      }
      else if (request.operation === "observe") {
        check(["advance", "salary200", "usd50", "delete10", "remove10", "replay10"].includes(request.kind),
          "STAGING_OBSERVE_KIND_INVALID");
        const snapshot = await adapter.readOnly((tx) => tx.snapshot());
        const observed = request.kind === "advance" ? observeAdvance(snapshot, plan, request.actionResult) :
          deriveCashProgress(snapshot, plan, request.priorObserved, request.kind, request.actionResult);
        const phase = request.kind === "replay10" ? "FINAL" : "PARTIAL";
        if (phase === "FINAL") observed.functional = expectedStageFinal(plan);
        const captured = await captureCashQa({ adapter, plan, observed, phase });
        result = { observed, captured };
      }
      else if (["cleanup", "abort-cleanup"].includes(request.operation)) {
        if (request.operation === "abort-cleanup") {
          assertCashStageAbortApproval(plan, request.captured, request.abortApproval);
        } else check(request.captured?.phase === "FINAL", "STAGING_FINAL_CAPTURE_REQUIRED");
        result = await cleanupCashQa({ adapter, plan, observed: request.observed, captured: request.captured,
          durableCaptureSha256: request.durableCaptureSha256, actionsDrained: request.actionsDrained === true });
      }
      else {
        const ids = [plan.actors.managerId, plan.actors.financeId, plan.users[0].id];
        const users = await prisma.user.findMany({ where: { id: { in: ids }, active: true },
          select: { id: true, roles: true, sessionVersion: true } });
        check(users.length === 3 && ids.every((id, index) => users.some((row) => row.id === id &&
          Number.isSafeInteger(row.sessionVersion) && (index === 2 ?
            same(row.roles, ["WORKER"]) : row.roles.some((role) =>
              (index ? ["ADMIN", "DIRECTOR", "ACCOUNTANT"] : ["ADMIN", "DIRECTOR", "MANAGER"]).includes(role))))),
          "STAGING_SESSION_ACTORS_MISSING");
        const secret = process.env.AUTH_SECRET;
        check(typeof secret === "string" && secret.length >= 32, "STAGING_AUTH_SECRET_REQUIRED");
        const { encode } = await import("@auth/core/jwt");
        const profiles = await Promise.all(ids.map(async (id, index) => {
          const user = users.find((row) => row.id === id);
          return cashStageCookieProfile(user, index === 2 ? "worker" : index ? "finance" : "manager", secret, encode);
        }));
        const manifestFile = "/app/apps/web/.next/server/server-reference-manifest.json";
        check(lstatSync(manifestFile).isFile() && !lstatSync(manifestFile).isSymbolicLink(), "STAGING_ACTION_MANIFEST_MISSING");
        const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
        result = { origin: ORIGIN, ttlSeconds: 900, sessions: profiles.slice(0, 2),
          workerSession: profiles[2], serverReferenceManifest: manifest };
      }
    }
    return { publicSummary: { status: "PASS", operation: request.operation, runId: result?.runId ?? plan?.runId ?? null,
      phase: result?.phase ?? null }, privatePayload: result };
  } finally { if (!deps.prisma) await prisma.$disconnect(); }
}

if (process.env.CRM_CASH_QA_INPUT) {
  void (async () => {
    const raw = process.env.CRM_CASH_QA_INPUT;
    check(raw.length <= 131072 && /^[A-Za-z0-9+/]*={0,2}$/.test(raw), "STAGING_INPUT_INVALID");
    delete process.env.CRM_CASH_QA_INPUT;
    return executeCashStage(JSON.parse(Buffer.from(raw, "base64").toString("utf8")));
  })().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    const code = error instanceof Error ? error.message : "";
    process.stdout.write(`${JSON.stringify({ publicSummary: { status: "STOP", code: /^[A-Z0-9_]+$/.test(code) ? code :
      "STAGING_ENTRY_FAILED_INSPECT" }, privatePayload: null })}\n`);
    process.exitCode = 2;
  });
}
