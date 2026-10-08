import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { paymentView } from "../src/server/finance/payment-view";

const row = { id: "payment", direction: "EXPENSE" as const, amount: new Prisma.Decimal(10), currency: "BYN",
  rate: new Prisma.Decimal(1), bynAmount: new Prisma.Decimal(10), projectAmount: null,
  paidAt: new Date("2026-10-08T09:00:00Z"), comment: null, createdById: "actor", cashAccount: { name: "Касса" },
  expenseArticle: { id: "materials", name: "Материалы" } };
test("shared financial projection retains unknown amounts and exposes only safe ready document fields", () => {
  const document = { id: "doc", fileName: "Чек.pdf", mimeType: "application/pdf", state: "READY" as const, storageKey: "SECRET", uploadedById: "SECRET" };
  const view = paymentView({ ...row, reportDocument: document }, new Map([["actor", "Бухгалтер"]]));
  assert.equal(view.projectAmount, null); assert.equal(view.createdByName, "Бухгалтер");
  assert.deepEqual(view.reportDocument, { id: "doc", fileName: "Чек.pdf", mimeType: "application/pdf", source: "finance" });
  assert.ok(!JSON.stringify(view).includes("SECRET"));
  assert.equal(paymentView({ ...row, reportDocument: { ...document, state: "PENDING" } }, new Map()).reportDocument, null);
  assert.equal(paymentView(row, new Map()).reportDocument, null);
});
