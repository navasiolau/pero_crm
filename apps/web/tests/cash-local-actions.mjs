/** Exact remaining local QA action payloads; import is inert. */
import { createHash } from "node:crypto";
import { cashActionOutcome } from "./cash-qa-browser.mjs";

const ORIGIN = "http://127.0.0.1:3106";
const SAFE_ID = /^[a-z0-9_-]{8,128}$/i;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const check = (ok, code) => { if (!ok) throw new Error(code); };
const RECORDED_SALARY_SHA = "1bc257d461ea9180f4866054d54c2c96ab70803098a14de4a25be1dfea56f812";
const RECORDED_SALARY_PAYOUT = "cmumahn9s000cvx88w2tys1zj";

export function cashResultRecord(result, valid) {
  const { status: httpStatus, ...rest } = result;
  return { ...rest, httpStatus, status: valid ? "ACTION_RESPONSE_CAPTURED" : "UNEXPECTED_RESPONSE_CAPTURE_REQUIRED" };
}

/** Read-only interpretation of one known, already-fsynced local response; never rewrite its bytes. */
export function recoverRecordedSalaryResult(result, originalSha256) {
  check(originalSha256 === RECORDED_SALARY_SHA && result?.kind === "salary200" && result.status === 200 &&
    result.outcome?.ok === true && result.outcome.repeated === false &&
    result.outcome.payoutId === RECORDED_SALARY_PAYOUT && /^[0-9a-f]{64}$/.test(result.requestSha256 ?? ""),
  "RECORDED_SALARY_RESULT_MISMATCH");
  return cashResultRecord(result, true);
}

export function assertCashUsdRefusalRecorded(intent, result) {
  check(intent?.kind === "usd50" && result?.kind === "usd50" &&
    result.status === "UNEXPECTED_RESPONSE_CAPTURE_REQUIRED" && result.httpStatus === 200 &&
    result.requestSha256 === intent.payloadSha256 && result.outcome?.ok === false &&
    result.outcome.error === "Не удалось получить корректный курс НБ РБ для выдачи",
  "USD_REFUSAL_PROOF_INVALID");
  return true;
}

export function cashRemainingIntent(plan, kind, month) {
  const marker = `QA-CASH ${plan.runId}`;
  if (kind === "salary200") {
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? ""), "SALARY_MONTH_INVALID");
    return { kind, role: "finance", path: "/finance/payroll", action: "addPayout",
      args: [{ userId: plan.users[1].id, cashAccountId: plan.accounts[0].id, cashAmount: "200.00",
        expectedCashCurrency: "BYN", requestId: plan.requestIds.salary, month, kind: "SALARY",
        comment: `${marker} salary` }] };
  }
  check(["usd50", "delete10"].includes(kind), "REMAINING_ACTION_FORBIDDEN");
  check(kind !== "usd50" || plan.mode === "USD", "USD_CASE_NOT_PLANNED");
  return { kind, role: "manager", path: "/advances", action: "issueAdvance",
    args: [{ userId: plan.users[0].id, cashAccountId: kind === "usd50" ? plan.accounts[1].id : plan.accounts[0].id,
      cashAmount: kind === "usd50" ? "50.00" : "10.00", expectedCashCurrency: kind === "usd50" ? "USD" : "BYN",
      description: `${marker} ${kind === "usd50" ? "USD" : "delete"}`,
      requestId: kind === "usd50" ? plan.requestIds.usd : plan.requestIds.delete }] };
}

export function cashDeleteIntent(payoutId) {
  check(SAFE_ID.test(payoutId ?? ""), "DELETE_PAYOUT_ID_INVALID");
  return { kind: "remove10", role: "finance", path: "/finance/payroll", action: "deletePayout", args: [payoutId] };
}

/** The caller must fsync an exclusive intent before calling this; any post-send failure is uncertain. */
export async function cashDirectActionOnce({ origin, intent, actionId, cookie, transport = fetch }) {
  check(origin === ORIGIN && ["/advances", "/finance/payroll"].includes(intent?.path) &&
    /^[0-9a-f]{42}$/i.test(actionId ?? "") && /^authjs\.session-token=[^;\s]+$/.test(cookie ?? ""),
  "ACTION_TRANSPORT_BINDING_INVALID");
  const body = JSON.stringify(intent.args), url = `${origin}${intent.path}`;
  let response, bytes;
  try {
    response = await transport(url, { method: "POST", redirect: "manual", cache: "no-store",
      headers: { "Content-Type": "application/json", "Next-Action": actionId, Origin: origin, Cookie: cookie },
      body, signal: AbortSignal.timeout(30000) });
    bytes = Buffer.from(await response.arrayBuffer());
    check(response.status === 200, "ACTION_HTTP_UNCERTAIN");
    const outcome = cashActionOutcome(bytes);
    return { outcome, requestSha256: sha(body), responseSha256: sha(bytes), status: response.status,
      bytes: bytes.length, action: intent.action, kind: intent.kind };
  } catch { throw new Error("ACTION_UPSTREAM_UNCERTAIN"); }
}
