/** Deterministic membership for the approved remaining cash payouts. Import is inert. */
const check = (ok, code) => { if (!ok) throw new Error(code); };
const rows = (snapshot, table) => snapshot.rows[table].map((raw) => JSON.parse(raw));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function cashRemainingPredecessor(plan, kind, localUsdException = false) {
  const sequence = ["salary200", ...(plan.mode === "USD" && !localUsdException ? ["usd50"] : []),
    "delete10", "remove10", "replay10"];
  const index = sequence.indexOf(kind);
  check(index >= 0, "REMAINING_ACTION_FORBIDDEN");
  return index === 0 ? "advance" : sequence[index - 1];
}

export function assertCashDeleteOwnership(snapshot, plan, priorObserved) {
  const target = priorObserved.outcomes.find((row) => row.requestId === plan.requestIds.delete && !row.deleted);
  const payout = rows(snapshot, "Payout").find((row) => row.id === target?.payoutId);
  const receipt = rows(snapshot, "ChangeLog").find((row) => row.id === `payout-issue:${plan.requestIds.delete}`);
  check(target && payout && receipt?.entityId === target.payoutId &&
    receipt.actorId === plan.actors.managerId && receipt.newValue?.userId === plan.users[0].id &&
    receipt.newValue?.kind === "ADVANCE" && payout.userId === plan.users[0].id &&
    payout.kind === "ADVANCE" && payout.cashAccountId === plan.accounts[0].id &&
    payout.cashCurrency === "BYN" && Number(payout.cashAmount) === 10,
  "DELETE_OWNERSHIP_MISMATCH");
  return target.payoutId;
}

export function deriveCashProgress(snapshot, plan, prior, kind, actionResult) {
  check(prior && Array.isArray(prior.outcomes) && prior.effectIds &&
    actionResult?.kind === kind && actionResult?.outcome &&
    prior.outcomes.length <= 4, "PROGRESS_INPUT_INVALID");
  const progress = structuredClone(prior), outcome = actionResult.outcome;
  if (["salary200", "usd50", "delete10"].includes(kind)) {
    const expected = kind === "salary200" ? { requestId: plan.requestIds.salary, actorId: plan.actors.financeId,
      kind: "SALARY", userId: plan.users[1].id, marker: "salary" } :
      kind === "usd50" ? { requestId: plan.requestIds.usd, actorId: plan.actors.managerId,
        kind: "ADVANCE", userId: plan.users[0].id, marker: "USD" } :
        { requestId: plan.requestIds.delete, actorId: plan.actors.managerId,
          kind: "ADVANCE", userId: plan.users[0].id, marker: "delete" };
    check(outcome.ok === true && outcome.repeated === false && typeof outcome.payoutId === "string" &&
      !prior.outcomes.some((row) => row.requestId === expected.requestId || row.payoutId === outcome.payoutId),
    "PAYOUT_RESULT_INVALID");
    const receipt = rows(snapshot, "ChangeLog").find((row) => row.id === `payout-issue:${expected.requestId}`);
    check(receipt?.entity === "payout" && receipt.action === "issue" && receipt.entityId === outcome.payoutId &&
      receipt.actorId === expected.actorId && receipt.newValue?.payoutId === outcome.payoutId &&
      receipt.newValue?.userId === expected.userId && receipt.newValue?.kind === expected.kind,
    "PAYOUT_RECEIPT_MISMATCH");
    const payout = rows(snapshot, "Payout").find((row) => row.id === outcome.payoutId);
    const expectedCash = kind === "salary200" ? [plan.accounts[0].id, "BYN", 200] :
      kind === "usd50" ? [plan.accounts[1].id, "USD", 50] : [plan.accounts[0].id, "BYN", 10];
    check(payout?.userId === expected.userId && payout.kind === expected.kind &&
      payout.cashAccountId === expectedCash[0] && payout.cashCurrency === expectedCash[1] &&
      Number(payout.cashAmount) === expectedCash[2] && payout.payrollCurrency === "BYN",
    "PAYOUT_MONEY_MISMATCH");
    const events = rows(snapshot, "DomainEvent").filter((row) => row.type === "payroll.payout" &&
      row.payload?.payoutId === outcome.payoutId);
    check(events.length === 1 && events[0].actor === expected.actorId, "PAYOUT_EVENT_MISMATCH");
    const expectedPairs = [
      ...(kind === "salary200" ? [] : [`payroll.payout|${expected.userId}`]),
      ...plan.actors.financeRecipientIds.filter((id) => id !== expected.actorId).map((id) => `payroll.orgPayout|${id}`),
    ];
    const notifications = rows(snapshot, "Notification").filter((row) => typeof row.body === "string" &&
      row.body.includes(`QA-CASH ${plan.runId} ${expected.marker}`) &&
      expectedPairs.includes(`${row.type}|${row.userId}`));
    check(notifications.length === expectedPairs.length &&
      same(notifications.map((row) => `${row.type}|${row.userId}`).sort(), [...expectedPairs].sort()),
    "PAYOUT_NOTIFICATION_MISMATCH");
    progress.outcomes.push({ requestId: expected.requestId, payoutId: outcome.payoutId, deleted: false });
    progress.effectIds.DomainEvent.push(events[0].id);
    progress.effectIds.Notification.push(...notifications.map((row) => row.id));
  } else if (kind === "remove10") {
    check(outcome.ok === true, "DELETE_RESULT_INVALID");
    const record = progress.outcomes.find((row) => row.requestId === plan.requestIds.delete && !row.deleted);
    check(record && !rows(snapshot, "Payout").some((row) => row.id === record.payoutId), "DELETE_PAYOUT_STILL_PRESENT");
    const logs = rows(snapshot, "ChangeLog").filter((row) => row.entity === "payout" && row.action === "delete" &&
      row.entityId === record.payoutId && row.actorId === plan.actors.financeId);
    check(logs.length === 1, "DELETE_AUDIT_MISMATCH");
    record.deleted = true;
    progress.effectIds.ChangeLog.push(logs[0].id);
  } else if (kind === "replay10") {
    check(outcome.ok === false && typeof outcome.error === "string" && outcome.error.includes("отменена") &&
      progress.outcomes.find((row) => row.requestId === plan.requestIds.delete)?.deleted === true,
    "DELETED_REPLAY_NOT_REFUSED");
    progress.duplicateReplay = true;
  } else throw new Error("REMAINING_ACTION_FORBIDDEN");
  return progress;
}
