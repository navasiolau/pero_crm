import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createPaymentInTransaction } from "../src/server/payments/transaction";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { readCashBalance, readOrgBalance } from "../src/server/payroll/cash-core";
import { createFinanceDocumentService } from "../src/server/finance-documents/core";

export async function financePaymentBaseline(db: PrismaClient) {
  const result: Record<string, unknown> = {};
  for (const table of ["User", "Payment", "FinanceDocument", "CashAccount", "ExpenseArticle", "ChangeLog", "DomainEvent"])
    result[table] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS digest FROM "${table}" t`);
  return result;
}

/** Реальное денежное ядро/PostgreSQL; вся фикстура откатывается до выхода, dispatch не вызывается. */
export async function runFinancePaymentNative(db: PrismaClient) {
  const before = await financePaymentBaseline(db), rollback = new Error("FINANCE98_EXPECTED_ROLLBACK");
  const marker = `qa-finance98-${randomUUID()}`;
  let checked = false;
  try {
    await createTaskTransaction(db)(async tx => {
      const project = await tx.project.findFirst({ where: { currency: "BYN", deletedAt: null }, select: { id: true, number: true, currency: true } });
      assert.ok(project, "LIVE_BYN_PROJECT_REQUIRED");
      const user = await tx.user.create({ data: { id: marker, name: marker, email: `${marker}@invalid.local`, passwordHash: "qa-login-disabled", roles: ["ACCOUNTANT"] } });
      const other = await tx.user.create({ data: { id: `${marker}-other`, name: marker, email: `${marker}-other@invalid.local`, passwordHash: "qa-login-disabled", roles: ["PROCUREMENT"] } });
      const actor = { id: user.id, name: user.name, roles: user.roles, source: "telegram" as const };
      const account = await tx.cashAccount.create({ data: { name: marker, currency: "BYN" } });
      const maxCode = await tx.expenseArticle.aggregate({ _max: { code: true } });
      const article = await tx.expenseArticle.create({ data: { name: marker, code: (maxCode._max.code ?? 0) + 1 } });
      const originalBalance = await readOrgBalance(tx, "1.000000");
      const funding = Prisma.Decimal.max(1000, originalBalance.negated().plus(1000));
      await tx.payment.create({ data: { amount: funding, bynAmount: funding, currency: "BYN", rate: 1, direction: "INCOME",
        cashAccountId: account.id, comment: marker, createdById: actor.id } });
      const storage = new Map<string, Buffer>();
      const documents = createFinanceDocumentService({ transaction: operation => operation(tx), storage: {
        mode: () => "local", put: async (document, bytes) => { storage.set(document.storageKey, bytes); }, open: async () => null,
      } });
      const uploaded = await documents.upload(user.id, { clientMutationId: randomUUID(), fileName: "Документ.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nQA98") });
      const input = { projectId: project.id, direction: "EXPENSE" as const, amount: 100, currency: "BYN", cashAccountId: account.id,
        expenseArticleId: article.id, reportDocumentId: uploaded.document.id, clientMutationId: randomUUID(), comment: marker };
      const prepared = { project, account, articleId: article.id, paidAt: new Date(), rate: 1, rateDate: null, amount: 100, bynAmount: 100 };
      await assert.rejects(createPaymentInTransaction({ ...actor, id: other.id, roles: other.roles }, { ...input, clientMutationId: randomUUID() }, prepared, tx), /документ/i);
      await tx.financeDocument.update({ where: { id: uploaded.document.id }, data: { state: "PENDING", readyAt: null } });
      await assert.rejects(createPaymentInTransaction(actor, input, prepared, tx), /документ/i);
      await tx.financeDocument.update({ where: { id: uploaded.document.id }, data: { state: "READY", readyAt: new Date() } });
      const first = await createPaymentInTransaction(actor, input, prepared, tx);
      const repeated = await createPaymentInTransaction(actor, input, prepared, tx);
      assert.equal(first.payment.id, repeated.payment.id); assert.equal(repeated.repeated, true);
      assert.equal(first.payment.reportDocumentId, uploaded.document.id);
      assert.equal((await readCashBalance(tx, account.id)).toFixed(2), funding.minus(100).toFixed(2));
      assert.equal(await tx.payment.count({ where: { cashAccountId: account.id, direction: "EXPENSE" } }), 1);
      assert.equal(await tx.domainEvent.count({ where: { actor: actor.id, type: "expense.created" } }), 1);
      await assert.rejects(createPaymentInTransaction(actor, { ...input, comment: "changed" }, prepared, tx), /другими данными/);
      await assert.rejects(createPaymentInTransaction(actor, { ...input, clientMutationId: randomUUID() }, prepared, tx), /документ/i);
      await tx.payment.delete({ where: { id: first.payment.id } });
      await assert.rejects(createPaymentInTransaction(actor, input, prepared, tx), /удалена/);
      checked = true;
      const faultTx = new Proxy(tx, { get(target, property, receiver) {
        if (property === "changeLog") return { ...target.changeLog, create: (args: Prisma.ChangeLogCreateArgs) => {
          if (args.data.action === "request") throw rollback;
          return target.changeLog.create(args);
        } };
        return Reflect.get(target, property, receiver);
      } });
      // Сбой последней записи receipt должен откатить уже записанные платёж, audit и outbox.
      await createPaymentInTransaction(actor, { ...input, clientMutationId: randomUUID() }, prepared, faultTx);
      assert.fail("RECEIPT_FAILURE_NOT_REACHED");
    });
  } catch (error) { if (error !== rollback) throw error; }
  assert.ok(checked);
  assert.deepEqual(await financePaymentBaseline(db), before, "ORIGINAL_DATA_CHANGED");
  return { status: "PASS", cashDebit: "100.00", paymentCount: 1, eventCount: 1, originalData: "MATCH", qaRows: "ROLLED_BACK" };
}
