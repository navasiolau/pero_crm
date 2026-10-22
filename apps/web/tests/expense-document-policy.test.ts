import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { paymentFingerprint, readPaymentReceipt } from "../src/server/payments/receipts";
import { paymentSchema } from "../src/server/payments/contracts";
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
let reads = 0;
const receiptLookup = {findUnique: async () => null};
// Только receipt proof разрешён до document policy; бизнес-БД/FX по-прежнему запрещены.
const forbidden = new Proxy({}, { get(_target, key) {if(key === "changeLog") return receiptLookup; reads++; throw Error("DATABASE_BEFORE_DOCUMENT_VALIDATION"); } });
inject("../src/lib/prisma", { prisma: forbidden });
inject("next/cache", { revalidatePath() {} });
const { createPaymentCore, createPaymentInTransaction } = require("../src/server/payments/service") as typeof import("../src/server/payments/service");
const actor = { id: "actor", name: "Actor", roles: ["ACCOUNTANT" as const], source: "web" as const };
const input = { clientMutationId: "00000134-0000-4000-8000-000000000109", projectId: "project", direction: "EXPENSE" as const, amount: 10, currency: "BYN", cashAccountId: "cash", expenseArticleId: "article" };
const prepared = { project: { id: "project", number: "1", currency: "BYN" }, account: { id: "cash", name: "Cash" }, articleId: "article", paidAt: new Date(), rate: 1, rateDate: null, amount: 10, bynAmount: 10 };

test("new ordinary expense requires document before business DB or FX work, forged exemption is ignored", async () => {
  for (const request of [input, { ...input, skipReportDocument: true, source: "warehouse" }]) {
    const result = await createPaymentCore(actor, request);
    assert.equal(result.ok, false); assert.match(result.error ?? "", /документ/i);
  }
  assert.equal(reads, 0);
});

test("legacy payment fingerprint stays byte-compatible and arrays have a distinct ordered version", () => {
  const legacy = { ...input, reportDocumentId: randomUUID(), comment: " Чек " };
  const original = createHash("sha256").update(JSON.stringify({ actorId: actor.id, projectId: legacy.projectId,
    direction: "EXPENSE", amount: "10.00", currency: "BYN", cashAccountId: "cash", expenseArticleId: "article",
    rate: null, rateDate: null, paidAt: null, comment: "Чек", reportDocumentId: legacy.reportDocumentId })).digest("hex");
  assert.equal(paymentFingerprint(actor.id, legacy), original);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  assert.notEqual(paymentFingerprint(actor.id, { ...input, reportDocumentIds: ids }), paymentFingerprint(actor.id, { ...input, reportDocumentId: ids[0] }));
  assert.notEqual(paymentFingerprint(actor.id, { ...input, reportDocumentIds: ids }), paymentFingerprint(actor.id, { ...input, reportDocumentIds: [...ids].reverse() }));
  assert.equal(paymentSchema.safeParse({ ...input, reportDocumentIds: [ids[0], ids[0]] }).success, false);
  assert.equal(paymentSchema.safeParse({ ...legacy, reportDocumentIds: ids }).success, false);
});

test("multi-document receipt proves every position before acknowledging COMMITTED", async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()], data = { ...input, reportDocumentIds: ids };
  const payment = { id: "complete", deletionId: null, reportDocumentId: ids[0], reportDocuments: ids.map((documentId, position) => ({ documentId, position })) };
  const db = { changeLog: { findUnique: async () => ({ actorType: "user", actorId: actor.id, entity: "payment", action: "request", entityId: payment.id,
    newValue: { version: 2, fingerprint: paymentFingerprint(actor.id, data) } }) }, payment: { findUnique: async () => payment } } as unknown as Prisma.TransactionClient;
  assert.equal((await readPaymentReceipt(actor, data, db))?.id, payment.id);
  payment.reportDocuments.pop(); await assert.rejects(readPaymentReceipt(actor, data, db), /полный комплект/);
  payment.reportDocuments = ids.map((documentId, position) => ({ documentId, position: position + 1 }));
  await assert.rejects(readPaymentReceipt(actor, data, db), /полный комплект/);
});

test("direct transaction seam cannot bypass expense document policy", async () => {
  reads = 0;
  await assert.rejects(createPaymentInTransaction(actor, input, prepared, forbidden as Prisma.TransactionClient), /документ/i);
  assert.equal(reads, 0);
});

test("exact legacy receipt without document remains readable and never repeats its writes", async () => {
  const legacy = { ...input, clientMutationId: randomUUID() };
  const payment = { id: "historical", reportDocumentId: null };
  const db = { changeLog: { findUnique: async () => ({ actorType: "user", actorId: actor.id, entity: "payment", action: "request", entityId: payment.id,
    newValue: { fingerprint: paymentFingerprint(actor.id, legacy) } }) }, payment: { findUnique: async () => payment } } as unknown as Prisma.TransactionClient;
  const result = await createPaymentInTransaction(actor, legacy, prepared, db);
  assert.equal(result.payment.id, "historical"); assert.equal(result.repeated, true);
});
