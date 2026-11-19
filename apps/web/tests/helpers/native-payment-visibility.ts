import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createPaymentInTransaction } from "../../src/server/payments/transaction";
import { deletePaymentInTransaction } from "../../src/server/payments/delete-core";
import { activePaymentWhere } from "../../src/server/payments/active-records";
import { readCashBalance, readOrgBalance } from "../../src/server/payroll/cash-core";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { readPaymentReceipt } from "../../src/server/payments/receipts";

/** Вызывается внешней приёмкой только внутри транзакции с обязательным откатом. */
export async function verifyPaymentVisibility(tx: Prisma.TransactionClient) {
  const id = randomUUID();
  const user = (role: "ACCOUNTANT" | "DIRECTOR") => tx.user.create({ data: {
    email: `${role}-${id}@example.invalid`, name: `Проверка №241 ${role}`, passwordHash: "disabled", roles: [role],
  } });
  const accountant = await user("ACCOUNTANT"), director = await user("DIRECTOR");
  const actor = { id: accountant.id, name: accountant.name, roles: accountant.roles, source: "web" as const };
  const cash = await tx.cashAccount.create({ data: { name: `Проверка №241 ${id}`, currency: "USD" } });
  const article = await tx.expenseArticle.findFirst({ where: { active: true } }) ?? await tx.expenseArticle.create({
    data: { code: ((await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1, name: "Проверка №241" },
  });
  const date = new Date("2026-11-01T00:00:00Z");
  const initial = await readOrgBalance(tx, "1");
  const deposit = Prisma.Decimal.max(0, initial.negated()).div(3).ceil().plus(150);
  await tx.payment.create({ data: { cashAccountId: cash.id, direction: "INCOME", amount: deposit,
    currency: "USD", rate: 3, bynAmount: deposit.times(3), paidAt: date } });
  const documents: string[] = [];
  for (const position of [0, 1]) {
    const document = await tx.financeDocument.create({ data: { uploadedById: accountant.id, clientMutationId: randomUUID(),
      requestFingerprint: id, state: "READY", readyAt: date, fileName: `Чек ${position}.pdf`, mimeType: "application/pdf",
      size: 5, contentHash: id, storageKey: `qa241/${id}/${position}`, storageMode: "local" } });
    documents.push(document.id);
  }
  const input = { direction: "EXPENSE" as const, cashAccountId: cash.id, amount: 10.25, currency: "USD" as const,
    expenseArticleId: article.id, comment: "Два чека", clientMutationId: randomUUID(), reportDocumentIds: documents };
  const before = await readCashBalance(tx, cash.id);
  const { payment } = await createPaymentInTransaction(actor, input, {
    account: cash, project: null, articleId: article.id, amount: 10.25, bynAmount: 30.75, rate: 3, rateDate: date, paidAt: date,
  }, tx);
  await deletePaymentInTransaction(actor, payment.id, tx);
  assert((await readCashBalance(tx, cash.id)).eq(before));
  assert.equal(await tx.payment.count({ where: { ...activePaymentWhere, id: payment.id } }), 0);
  await assert.rejects(readPaymentReceipt(actor, input, tx), /удалена/);
  const entry = await tx.changeLog.findFirstOrThrow({ where: { entity: "payment", entityId: payment.id, action: "delete" } });
  const request = { entryId: entry.id, scope: { kind: "global" }, requestId: randomUUID() };
  await assert.rejects(previewJournalReversalInTransaction(tx, accountant.id, request), /прав/);
  const spent = await tx.payment.create({ data: { cashAccountId: cash.id, direction: "EXPENSE", amount: before,
    currency: "USD", rate: 3, bynAmount: before.times(3) } });
  await assert.rejects(reverseJournalActionInTransaction(tx, director.id, request), /остаток кассы/);
  assert.equal(await tx.changeLog.count({ where: { reversesId: entry.id } }), 0);
  await tx.payment.update({ where: { id: spent.id }, data: { deletedAt: new Date(), deletedById: director.id } });
  await previewJournalReversalInTransaction(tx, director.id, request);
  const result = await reverseJournalActionInTransaction(tx, director.id, request);
  assert.equal((await reverseJournalActionInTransaction(tx, director.id, request)).reversalId, result.reversalId);
  assert.equal(await tx.changeLog.count({ where: { reversesId: entry.id } }), 1);
  const restored = await tx.payment.findFirstOrThrow({ where: { ...activePaymentWhere, id: payment.id },
    include: { reportDocuments: { orderBy: { position: "asc" } } } });
  assert.deepEqual(restored.reportDocuments.map(file => file.documentId), documents);
  assert.equal(restored.deletedById, null);
  assert.equal(restored.bynAmount.toFixed(2), "30.75");
  assert.equal(restored.paidAt.toISOString(), date.toISOString());
  assert.equal(restored.rateDate?.toISOString(), date.toISOString());
  assert((await readCashBalance(tx, cash.id)).eq(before.minus("10.25")));
  await reverseJournalActionInTransaction(tx, director.id, { ...request, entryId: result.reversalId, requestId: randomUUID() });
  assert((await readCashBalance(tx, cash.id)).eq(before));
  return { restoredPayment: true, orderedDocuments: documents.length, historicalFx: true, insufficientFunds: true, repeatedOnce: true, redo: true };
}
