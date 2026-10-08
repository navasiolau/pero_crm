import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { Prisma, type Payment } from "@prisma/client";
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
inject("next/cache", { revalidatePath() {} });
inject("../src/server/projects/core", { requireActorRoles() {} });
inject("../src/server/payroll/cash-core", { readCashBalance: async () => new Prisma.Decimal(1000), readOrgBalance: async () => new Prisma.Decimal(1000) });
const { createPaymentInTransaction } = require("../src/server/payments/core") as typeof import("../src/server/payments/core");
const actor = { id: "actor", name: "Actor", roles: ["ACCOUNTANT" as const], source: "telegram" as const };
function fixture() {
  const documentId = randomUUID();
  const doc = { id: documentId, state: "READY", uploadedById: actor.id, payment: null as { id: string } | null };
  const receipts = new Map<string, Record<string, unknown>>(), payments = new Map<string, Payment>();
  let writes = 0, audits = 0, events = 0;
  const tx = {
    user: { findUnique: async () => ({ id: actor.id, name: actor.name, roles: actor.roles, active: true }) },
    financeDocument: { findUnique: async ({ where }: { where: { id: string } }) => where.id === doc.id ? doc : null },
    project: { findUnique: async () => ({ currency: "BYN" }) },
    cashAccount: { findUnique: async () => ({ active: true, currency: "BYN" }) },
    expenseArticle: { findUnique: async () => ({ active: true }) },
    changeLog: {
      findUnique: async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { audits++; const id = String(data.id ?? randomUUID()); receipts.set(id, { ...data, id }); return { ...data, id }; },
    },
    payment: {
      findUnique: async ({ where }: { where: { id: string } }) => payments.get(where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes++; const id = randomUUID(); const row = { ...data, id } as unknown as Payment; payments.set(id, row);
        if (data.reportDocumentId) doc.payment = { id }; return row;
      },
    },
    domainEvent: { create: async () => { events++; return { id: randomUUID() }; } },
  } as unknown as Prisma.TransactionClient;
  const input = { projectId: "project", direction: "EXPENSE" as const, amount: 100, currency: "BYN", cashAccountId: "cash",
    expenseArticleId: "article", reportDocumentId: documentId, clientMutationId: randomUUID() };
  const prepared = { project: { id: "project", number: "205", currency: "BYN" }, account: { id: "cash", name: "Касса" },
    articleId: "article", paidAt: new Date("2026-10-08T09:00:00Z"), rate: 1, rateDate: null, amount: 100, bynAmount: 100 };
  return { tx, doc, input, prepared, payments, get writes() { return writes; }, get audits() { return audits; }, get events() { return events; } };
}

test("expense binds confirmed document; exact retry returns same payment without new money/audit/event", async () => {
  const f = fixture();
  const first = await createPaymentInTransaction(actor, f.input, f.prepared, f.tx);
  assert.equal(first.payment.reportDocumentId, f.doc.id);
  const audits = f.audits;
  const repeated = await createPaymentInTransaction(actor, f.input, f.prepared, f.tx);
  assert.equal(repeated.payment.id, first.payment.id); assert.equal(f.writes, 1); assert.equal(f.audits, audits); assert.equal(f.events, 1);
});

test("unknown, pending, foreign or already attached documents cannot create an expense", async () => {
  const missing = fixture();
  await assert.rejects(createPaymentInTransaction(actor, { ...missing.input, reportDocumentId: randomUUID() }, missing.prepared, missing.tx), /документ/i);
  for (const change of [{ state: "PENDING" }, { uploadedById: "another" }, { payment: { id: "other-payment" } }]) {
    const f = fixture(); Object.assign(f.doc, change);
    await assert.rejects(createPaymentInTransaction(actor, f.input, f.prepared, f.tx), /документ/i);
    assert.equal(f.writes, 0); assert.equal(f.audits, 0); assert.equal(f.events, 0);
  }
});

test("mutation UUID cannot be reused with different data, another actor or after deletion", async () => {
  const f = fixture(); await createPaymentInTransaction(actor, f.input, f.prepared, f.tx);
  await assert.rejects(createPaymentInTransaction(actor, { ...f.input, comment: "different" }, f.prepared, f.tx), /другими данными/);
  await assert.rejects(createPaymentInTransaction({ ...actor, id: "other" }, f.input, f.prepared, f.tx), /другими данными/);
  f.payments.clear();
  await assert.rejects(createPaymentInTransaction(actor, f.input, f.prepared, f.tx), /удалена/);
  assert.equal(f.writes, 1);
});
