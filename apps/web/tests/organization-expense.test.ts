import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { paymentSchema } from "../src/server/payments/contracts";
import { assertExpenseReportDocument } from "../src/server/payments/document-policy";
import { Prisma } from "@prisma/client";
import { loadOrganizationPayments } from "../src/server/finance/organization-ledger";
import { deletePaymentInTransaction } from "../src/server/payments/delete-core";

test("ordinary expense can have no project, while document remains required", () => {
  const input = { projectId: null, direction: "EXPENSE" as const, amount: 100, currency: "BYN", cashAccountId: "cash",
    expenseArticleId: "article", reportDocumentId: randomUUID(), clientMutationId: randomUUID() };
  assert.equal(paymentSchema.safeParse(input).success, true);
  assert.doesNotThrow(() => assertExpenseReportDocument(input));
  assert.throws(() => assertExpenseReportDocument({ ...input, reportDocumentId: undefined }), /документ/);
});

test("general income still cannot disguise an expense article", () => {
  const input = { direction: "INCOME", amount: 100, currency: "BYN", cashAccountId: "cash" };
  assert.equal(paymentSchema.safeParse(input).success, true);
  assert.equal(paymentSchema.safeParse({ ...input, expenseArticleId: "article" }).success, false);
});

test("expense reader includes safe document and nullable project but rejects nonfinance before data read", async () => {
  let reads = 0;
  const db = { payment: { findMany: async ({ where }: { where: { direction: string } }) => { reads++; assert.equal(where.direction, "EXPENSE"); return [{
    id: "payment", direction: "EXPENSE", amount: new Prisma.Decimal(100), rate: new Prisma.Decimal(1), bynAmount: new Prisma.Decimal(100), projectAmount: null,
    currency: "BYN", rateDate: null, paidAt: new Date(), comment: "Общий расход", createdById: null, project: null, cashAccount: { name: "Касса" }, expenseArticle: { name: "Логистика" },
    reportDocument: { id: "document", state: "READY", fileName: "Чек.pdf", mimeType: "application/pdf", storageKey: "SECRET" },
  }]; } }, cashAccount: { findMany: async () => [] }, project: { findMany: async () => [] } } as unknown as Parameters<typeof loadOrganizationPayments>[2];
  await assert.rejects(loadOrganizationPayments({ id: "manager", roles: ["MANAGER"] }, "EXPENSE", db), /прав/); assert.equal(reads, 0);
  const result = await loadOrganizationPayments({ id: "finance", roles: ["ACCOUNTANT"] }, "EXPENSE", db);
  assert.equal(result.rows[0].project, null); assert.equal(result.rows[0].projectAmount, null);
  assert.equal(result.rows[0].reportDocument?.source, "finance"); assert.equal(result.rows[0].expenseArticleName, "Логистика");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("common ledger cannot delete financial history of an archived project", async () => {
  let writes = 0;
  const tx = { payment: { findUnique: async () => ({ project: { id: "archived", deletedAt: new Date() }, direction: "EXPENSE" }), delete: async () => { writes++; } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(deletePaymentInTransaction({ id: "actor", name: "Actor", roles: ["ACCOUNTANT"], source: "web" }, "payment", "EXPENSE", "BYN", "1", tx), /только для просмотра/);
  assert.equal(writes, 0);
});
