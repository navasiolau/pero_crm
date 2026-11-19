import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { reverseJournalActionInTransaction, previewJournalReversalInTransaction } from "../../src/server/changelog/reversal-core";
import { warehouseMove } from "../../src/server/warehouse/accounting";
import { loadExpenseIssueChoices, loadExpenseIssueQuote, postExpenseIssueInTransaction } from "../../src/server/warehouse/expense-issue-core";
import { expenseReceiptReversal } from "../../src/server/warehouse/expense-receipt-reversal";
import { loadExpenseReceiptPreview, postExpenseReceiptInTransaction } from "../../src/server/warehouse/expense-receipt-core";
import type { PostgresRows } from "../integration/postgres.fixture";

export async function verifyNativeExpenseReceiptIssue(tx: Prisma.TransactionClient, fixtures: PostgresRows) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  const state = await tx.warehouseAccountingState.upsert({ where: { id: "main" }, update: {},
    create: { id: "main", phase: "ACTIVE", runId: fixtures.id("issue-accounting"), beforePrices: [], beforeBalances: [] } });
  assert.equal(state.phase, "ACTIVE", "CI_WAREHOUSE_PHASE_MISMATCH");
  const adminUser = await fixtures.user("issue-admin", ["ADMIN"]), financeUser = await fixtures.user("issue-accountant", ["ACCOUNTANT"]);
  const admin = { ...adminUser, source: "web" as const }, actor = { ...financeUser, source: "web" as const };
  const project = await fixtures.project("issue-project");
  const product = await fixtures.product("issue-product", project.id, { status: "PRODUCTION" });
  const draft = await fixtures.product("issue-draft", project.id, { status: "DRAFT" });
  const unit = await tx.materialUnit.create({ data: { name: fixtures.id("issue-unit") } });
  const material = await tx.material.create({ data: { unitId: unit.id, name: "Материал для проверки выдачи" } });
  const cash = await tx.cashAccount.create({ data: { name: fixtures.id("issue-cash"), currency: "BYN" } });
  const payment = await tx.payment.create({ data: { direction: "EXPENSE", amount: "100", bynAmount: "100", cashAccountId: cash.id } });
  const receiptInput = { paymentId: payment.id, lines: [{ materialId: material.id, quantity: "10", amount: "100" }] };
  const receiptQuote = await loadExpenseReceiptPreview(tx, admin, receiptInput);
  const receipt = await postExpenseReceiptInTransaction(tx, admin, { ...receiptInput, clientMutationId: randomUUID(), fingerprint: receiptQuote.fingerprint });
  await warehouseMove(tx, admin, { kind: "INCOME", clientMutationId: randomUUID(), materialId: material.id, quantity: "10", unitPrice: "20" });
  const originalPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  const options = await loadExpenseIssueChoices(tx, actor, { paymentId: payment.id, projectId: project.id });
  assert.ok(options.choices.some(option => option.id === product.id));
  assert.ok(!options.choices.some(option => option.id === draft.id));
  await assert.rejects(loadExpenseIssueChoices(tx, { ...actor, roles: ["PROCUREMENT"] }, { paymentId: payment.id }), /Недостаточно прав/);
  const source = options.sources[0];
  const input = { paymentId: payment.id, projectId: project.id, productId: product.id, lines: [{ sourceMovementId: source.movementId, quantity: "2" }] };
  const quote = await loadExpenseIssueQuote(tx, actor, input);
  assert.equal(quote.totalByn, "30.00");
  assert.equal(quote.lines[0].warehouseAfter, "18.000");
  const request = { ...input, requestId: randomUUID(), fingerprint: quote.fingerprint };
  const posted = await postExpenseIssueInTransaction(tx, actor, request);
  assert.equal((await postExpenseIssueInTransaction(tx, actor, request)).issueId, posted.issueId);
  assert.deepEqual(await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }), originalPayment);
  const stocked = await tx.expenseReceiptIssue.findUniqueOrThrow({ where: { id: posted.issueId }, include: { lines: true } });
  assert.equal(stocked.lines.length, 1);
  assert.equal((await loadExpenseIssueChoices(tx, actor, { paymentId: payment.id })).sources[0].remainingQuantity, "8.000");
  const receiptEvent = await tx.changeLog.findUniqueOrThrow({ where: { id: originalPayment.lastActionId! } });
  assert.ok(receiptEvent.reversal);
  const receiptReversal = expenseReceiptReversal.read((receiptEvent.reversal as { data?: unknown }).data);
  assert.ok(receiptReversal);
  await assert.rejects(receiptReversal.preview({ tx, actor: admin, entityId: payment.id, entryId: receiptEvent.id }), /Сначала отмените/);
  const entryId = "expense-issue:" + posted.issueId, scope = { kind: "product", id: product.id };
  await reverseJournalActionInTransaction(tx, admin.id, { entryId, scope, requestId: randomUUID() });
  assert.equal((await loadExpenseIssueChoices(tx, actor, { paymentId: payment.id })).sources[0].remainingQuantity, "10.000");
  assert.deepEqual(await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }), originalPayment);
  const issueQuote = await loadExpenseIssueQuote(tx, actor, input);
  const second = await postExpenseIssueInTransaction(tx, actor, { ...input, requestId: randomUUID(), fingerprint: issueQuote.fingerprint });
  const sourceIssue = await tx.expenseReceiptIssue.findUniqueOrThrow({ where: { id: second.issueId }, include: { lines: true } });
  await warehouseMove(tx, admin, { kind: "RETURN", clientMutationId: randomUUID(), productId: product.id, quantity: "1", sourceMovementId: sourceIssue.lines[0].movementId });
  assert.equal((await loadExpenseIssueChoices(tx, actor, { paymentId: payment.id })).sources[0].issuedQuantity, "1.000");
  await assert.rejects(previewJournalReversalInTransaction(tx, admin.id, {
    entryId: "expense-issue:" + second.issueId, scope,
  }), /связанный возврат/);
  assert.equal((await tx.expenseReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } })).cancelledAt, null);
}
