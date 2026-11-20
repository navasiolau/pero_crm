import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { assignOrdinaryExpenseProjectInTransaction } from "../../src/server/payments/project-assignment-core";
import { readCashBalance } from "../../src/server/payroll/cash-core";
import type { PostgresRows } from "../integration/postgres.fixture";

export async function verifyExpenseProjectAssignmentNative(tx: Prisma.TransactionClient, rows: PostgresRows) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  const accountant = await rows.user("assign-accountant", ["ACCOUNTANT", "WORKER"]);
  const admin = await rows.user("assign-admin", ["ADMIN"]);
  const actor = { id: accountant.id, name: accountant.name, roles: accountant.roles, source: "web" as const };
  const [first, second] = await Promise.all([rows.project("assign-first"), rows.project("assign-second")]);
  const cash = await tx.cashAccount.create({ data: { name: rows.id("assign-cash"), currency: "EUR" } });
  await tx.payment.create({ data: { cashAccountId: cash.id, amount: "80.00", bynAmount: "256.00", currency: "EUR", rate: "3.2" } });
  const expense = await tx.payment.create({ data: { direction: "EXPENSE", cashAccountId: cash.id, amount: "12.51",
    bynAmount: "40.03", currency: "EUR", rate: "3.2", projectId: first.id, projectAmount: "40.01", comment: "Исторический расход" } });
  const balance = (await readCashBalance(tx, cash.id)).toFixed(2);
  const fromFirst = { paymentId: expense.id, expectedProjectId: first.id, expectedHead: expense.lastActionId, projectId: second.id };
  const move = await assignOrdinaryExpenseProjectInTransaction(actor, fromFirst, tx);
  assert.ok(move.changed);
  assert.equal((await tx.payment.findUniqueOrThrow({ where: { id: expense.id } })).projectAmount?.toFixed(2), "40.03");
  await assert.rejects(assignOrdinaryExpenseProjectInTransaction(actor, fromFirst, tx), /Расход изменился/);
  const detach = await assignOrdinaryExpenseProjectInTransaction(actor, {
    ...fromFirst, expectedProjectId: second.id, expectedHead: move.id, projectId: null,
  }, tx);
  assert.ok(detach.changed);
  assert.equal((await tx.payment.findUniqueOrThrow({ where: { id: expense.id } })).projectAmount, null);
  const scope = { kind: "project", id: first.id };
  await assert.rejects(previewJournalReversalInTransaction(tx, admin.id, { entryId: move.id, scope }), /более позднее/);
  const global = { kind: "global" };
  await reverseJournalActionInTransaction(tx, admin.id, { entryId: detach.id, scope: global, requestId: randomUUID() });
  const preview = await previewJournalReversalInTransaction(tx, admin.id, { entryId: move.id, scope });
  assert.equal(preview.entryId, move.id);
  const undo = await reverseJournalActionInTransaction(tx, admin.id, { entryId: move.id, scope, requestId: randomUUID() });
  assert.ok(undo.cachePaths?.includes("/finance/projects/" + second.id));
  assert.deepEqual(await tx.payment.findUniqueOrThrow({ where: { id: expense.id } }), expense);
  assert.equal((await readCashBalance(tx, cash.id)).toFixed(2), balance);
  const receipt = await tx.expenseReceipt.create({ data: { paymentId: expense.id, clientMutationId: randomUUID(), requestFingerprint: "native", actorId: actor.id } });
  await assert.rejects(assignOrdinaryExpenseProjectInTransaction(actor, fromFirst, tx), /Складской расход/);
  await tx.expenseReceipt.update({ where: { id: receipt.id }, data: { cancelledAt: new Date() } });
  assert.ok((await assignOrdinaryExpenseProjectInTransaction(actor, fromFirst, tx)).changed);
}
