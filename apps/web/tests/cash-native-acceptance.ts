/** Native cash QA entrypoint. Dry-run by default; actual clients/transport are injected by a reviewed runner. */
/* eslint-disable @typescript-eslint/no-explicit-any -- the future runner injects an adapter checked at every boundary */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createCashQaSqlAdapter } from "./cash-qa-adapter.mjs";
import { baselineCashQa, canonical, captureCashQa, cashPlanSha256, cleanupCashQa, inspectCashCapture,
  prepareCashQa, validateCashQaPlan } from "./cash-owned-fixtures.mjs";

const OPERATIONS = new Set(["baseline", "prepare", "capture", "cleanup", "negative", "lock-proof", "duplicate"]);
function stop(code: string): never { throw new Error(code); }

export function parseCashNativeArgs(args: string[]) {
  if (args.length === 0 || (args.length === 1 && args[0] === "dry-run")) return { mode: "dry-run" as const };
  if (args.length === 2 && args[0] === "--execute" && OPERATIONS.has(args[1])) return { mode: "execute" as const, operation: args[1] };
  return stop("CASH_NATIVE_USAGE_INVALID");
}

type NativeOptions = {
  args?: string[];
  plan?: any;
  durablePlanSha256?: string;
  approval?: { source: "owner-reviewed"; planSha256: string; sqlSha256: string; targetKind: string };
  prisma?: any;
  attestation?: any;
  captured?: any;
  durableCaptureSha256?: string;
  actionsDrained?: boolean;
  observed?: any;
  phase?: "ABSENT" | "INITIAL" | "PARTIAL" | "FINAL";
  sendApprovedAction?: (input: { userId: string; cashAccountId: string; cashAmount: string; expectedCashCurrency: "BYN";
    description: string; requestId: string }) => Promise<any>;
};

async function rollbackNegative(adapter: any, plan: any) {
  const result = await adapter.rollbackOnly(async (tx: any) => {
    inspectCashCapture(await tx.snapshot(), plan, { outcomes: [], effectIds: {} }, "INITIAL");
    const db = tx.prismaTx;
    const invalidId = randomUUID(); // rollback-only; never becomes an approved fixture
    await db.$executeRawUnsafe("SAVEPOINT cash_qa_invalid_payout");
    let sqlState = "";
    try {
      await db.$executeRawUnsafe('INSERT INTO public."Payout" (id,"userId",amount,month,kind,"cashAccountId") VALUES ($1,$2,1.00,$3,\'ADVANCE\',$4)',
        invalidId, plan.users[0].id, new Date().toISOString().slice(0, 7), plan.accounts[0].id);
    } catch (error: any) {
      sqlState = String(error?.meta?.code ?? error?.code ?? "");
    } finally {
      await db.$executeRawUnsafe("ROLLBACK TO SAVEPOINT cash_qa_invalid_payout");
    }
    if (sqlState !== "23514") stop("PAYOUT_SQL_CHECK_NOT_PROVEN");
    const { issuePayoutCore } = await import("../src/server/payroll/cash-core");
    const day = new Date().toISOString().slice(0, 10);
    const rate = { asOf: day, cash: { currency: "BYN" as const, rate: "1.000000", date: day },
      payroll: { currency: "BYN" as const, rate: "1.000000", date: day } };
    const actor = { id: plan.actors.managerId, name: "QA manager", roles: ["MANAGER"] as const, source: "web" as const };
    const request = { kind: "ADVANCE" as const, userId: plan.users[0].id, cashAccountId: plan.accounts[0].id,
      cashAmount: "120.00", expectedCashCurrency: "BYN" as const, description: `QA-CASH ${plan.runId} advance`,
      requestId: plan.requestIds.advance };
    await assertRejected(() => issuePayoutCore(actor as any, { ...request, userId: plan.users[1].id }, rate, db), /Активный сотрудник/);
    await assertRejected(() => issuePayoutCore(actor as any, { ...request, cashAmount: "9999999999.99" }, rate, db), /Недостаточно средств/);
    const first = await issuePayoutCore(actor as any, request, rate, db);
    const replay = await issuePayoutCore(actor as any, request, rate, db);
    if (first.repeated || !replay.repeated || first.payoutId !== replay.payoutId) stop("ROLLBACK_DUPLICATE_FAILED");
    const count = await db.payout.count({ where: { id: first.payoutId } });
    const accruals = await db.payrollEntry.count({ where: { userId: { in: plan.users.map((u: any) => u.id) } } });
    if (count !== 1 || accruals !== 1) stop("ROLLBACK_WRITE_SET_INVALID");
    return { sqlState, inactiveAdvance: "REFUSED", overdraft: "REFUSED", duplicate: "ONE_WITH_REPLAY" };
  });
  const post = await captureCashQa({ adapter, plan, observed: { outcomes: [], effectIds: {} }, phase: "INITIAL" });
  if (post.phase !== "INITIAL") stop("ROLLBACK_POSTCHECK_FAILED");
  return { status: "ROLLBACK_NEGATIVE_PASS", ...result, persistentRows: 0 };
}

async function assertRejected(action: () => Promise<unknown>, pattern: RegExp) {
  try { await action(); } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  stop("EXPECTED_REFUSAL_MISSING");
}

async function duplicateApproved(adapter: any, plan: any, sendApprovedAction: NativeOptions["sendApprovedAction"]) {
  if (!sendApprovedAction) stop("APPROVED_ACTION_TRANSPORT_REQUIRED");
  await captureCashQa({ adapter, plan, observed: { outcomes: [], effectIds: {} }, phase: "INITIAL" });
  const payload = { userId: plan.users[0].id, cashAccountId: plan.accounts[0].id, cashAmount: "120.00" as const,
    expectedCashCurrency: "BYN" as const, description: `QA-CASH ${plan.runId} advance`, requestId: plan.requestIds.advance };
  const responses = await Promise.allSettled([sendApprovedAction(payload), sendApprovedAction(payload)]);
  if (responses.some((row) => row.status !== "fulfilled" || !row.value?.ok)) {
    return { status: "UNCERTAIN_CAPTURE_REQUIRED", requestId: payload.requestId, noAutoRetry: true };
  }
  const values = responses.map((row: any) => row.value);
  if (values[0].payoutId !== values[1].payoutId || values.filter((row: any) => row.repeated === false).length !== 1 ||
    values.filter((row: any) => row.repeated === true).length !== 1) stop("DUPLICATE_RESPONSE_MISMATCH_CAPTURE_REQUIRED");
  const proof = await adapter.readOnly(async (tx: any) => {
    const receipt = await tx.prismaTx.changeLog.findUnique({ where: { id: `payout-issue:${payload.requestId}` } });
    const payout = await tx.prismaTx.payout.findUnique({ where: { id: values[0].payoutId } });
    const snapshot = await tx.snapshot();
    const qaPayouts = snapshot.rows.Payout.map((raw: string) => JSON.parse(raw)).filter((row: any) =>
      row.userId === payload.userId && row.cashAccountId === payload.cashAccountId);
    const events = snapshot.rows.DomainEvent.map((raw: string) => JSON.parse(raw)).filter((row: any) =>
      row.type === "payroll.payout" && row.payload?.payoutId === payout?.id);
    if (receipt?.id !== `payout-issue:${payload.requestId}` || receipt.entityId !== payout?.id ||
      receipt.actorId !== plan.actors.managerId || receipt.newValue?.kind !== "ADVANCE" ||
      receipt.newValue?.userId !== payload.userId || payout?.userId !== payload.userId || payout.kind !== "ADVANCE" ||
      payout.cashAccountId !== payload.cashAccountId || payout.cashCurrency !== "BYN" || payout.payrollCurrency !== "BYN" ||
      payout.cashAmount?.toFixed(2) !== "120.00" || payout.amount?.toFixed(2) !== "120.00" ||
      payout.bynAmount?.toFixed(2) !== "120.00" || qaPayouts.length !== 1 || events.length !== 1)
      stop("DUPLICATE_LEDGER_MISMATCH_CAPTURE_REQUIRED");
    return { payoutId: payout.id, receiptId: receipt.id };
  });
  return { status: "DUPLICATE_ONCE", requestId: payload.requestId, ...proof, captureRequired: true };
}

export async function runCashNativeAcceptance(options: NativeOptions = {}) {
  const parsed = parseCashNativeArgs(options.args ?? []);
  if (parsed.mode === "dry-run") return { status: "DRY_RUN", connectionOpened: false,
    operations: [...OPERATIONS], planHash: options.plan ? cashPlanSha256(options.plan) : null };
  const plan = validateCashQaPlan(options.plan);
  const hash = cashPlanSha256(plan);
  if (options.durablePlanSha256 !== hash || options.approval?.source !== "owner-reviewed" ||
    options.approval.planSha256 !== hash || options.approval.sqlSha256.toLowerCase() !== plan.sqlSha256.toLowerCase() ||
    options.approval.targetKind !== plan.target.kind) stop("DURABLE_APPROVED_PLAN_REQUIRED");
  if (!options.prisma || !options.attestation) stop("INJECTED_RUNTIME_REQUIRED");
  const adapter = createCashQaSqlAdapter({ prisma: options.prisma, target: plan.target,
    attestation: options.attestation, plan, approvedCapture: options.captured, writeAuthorization: options.approval });
  switch (parsed.operation) {
    case "baseline": {
      const observed = await baselineCashQa(adapter, plan.target, plan.schema.tables, plan.schema.hash);
      if (canonical(observed) !== canonical(plan.baseline)) stop("BASELINE_DRIFT");
      return { status: "BASELINE_MATCH", fingerprints: observed };
    }
    case "prepare": return prepareCashQa({ adapter, plan, durablePlanSha256: hash });
    case "capture": {
      if (!options.observed || !options.phase) stop("CAPTURE_INPUT_REQUIRED");
      return captureCashQa({ adapter, plan, observed: options.observed, phase: options.phase });
    }
    case "cleanup": return cleanupCashQa({ adapter, plan, observed: options.observed, captured: options.captured,
      durableCaptureSha256: options.durableCaptureSha256, actionsDrained: options.actionsDrained });
    case "negative": return rollbackNegative(adapter, plan);
    case "lock-proof": return adapter.probeLockPair();
    case "duplicate": return duplicateApproved(adapter, plan, options.sendApprovedAction);
    default: return stop("OPERATION_FORBIDDEN");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCashNativeAcceptance({ args: process.argv.slice(2) }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
