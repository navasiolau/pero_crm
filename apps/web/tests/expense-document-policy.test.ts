import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { paymentFingerprint } from "../src/server/payments/receipts";
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
const { createPaymentCore, createPaymentInTransaction } = require("../src/server/payments/core") as typeof import("../src/server/payments/core");
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
