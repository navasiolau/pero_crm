import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { createLogisticsTripCore } from "../../src/server/logistics/core";
import { createLogisticsPostingCore } from "../../src/server/logistics/posting-core";
import { prepareReallocation, redistributeTripInTransaction } from "../../src/server/logistics/reallocation-core";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { readCashBalance, readOrgBalance } from "../../src/server/payroll/cash-core";
import { activePaymentWhere } from "../../src/server/payments/active-records";

export async function verifyLogisticsReallocationNative(tx: Prisma.TransactionClient) {
  const run = randomUUID();
  const user = (label: string, roles: Role[]) => tx.user.create({ data: { name: label, email: `${run}-${label}@example.invalid`,
    passwordHash: "QA249_NO_LOGIN", roles } });
  const [director, accountant, procurement] = await Promise.all([
    user("qa249-director", ["DIRECTOR"]), user("qa249-accountant", ["ACCOUNTANT", "ENGINEER"]), user("qa249-procurement", ["PROCUREMENT"]),
  ]);
  const client = await tx.client.create({ data: { name: "Проверка №249", phone: "QA249" } });
  const numberInt = 1_200_000_000 + Number.parseInt(run.slice(0, 7), 16);
  async function projectAndProduct(number: number) {
    const project = await tx.project.create({ data: { title: "Проверка №249", clientId: client.id, numberInt: number, number: String(number), currency: "BYN" } });
    const product = await tx.product.create({ data: { projectId: project.id, title: "Проверка №249", number: `${number}.1`, suffixInt: 1, status: "PRODUCTION" } });
    return { project, product };
  }
  const [a, b] = await Promise.all([projectAndProduct(numberInt), projectAndProduct(numberInt + 1)]);
  const account = await tx.cashAccount.create({ data: { name: `Проверка №249 ${run}`, currency: "USD" } });
  await tx.payment.create({ data: { direction: "INCOME", amount: "1000.00", rate: "1.50", bynAmount: "1500.00", currency: "USD", cashAccountId: account.id } });
  const original = { shares: [{ projectId: a.project.id, percentBps: 10000 }],
    lines: [{ projectId: a.project.id, kind: "PRODUCT" as const, productId: a.product.id, quantity: 1 }] };
  const transaction = async <T>(operation: (db: Prisma.TransactionClient) => Promise<T>) => operation(tx);
  const trip = await createLogisticsTripCore(director.id, { ...original, date: "2026-11-20", comment: "Проверка №249",
    ttnNotRequired: true, clientMutationId: randomUUID() }, transaction);
  const document = await tx.logisticsDocument.create({ data: {
    tripId: trip.tripId, clientMutationId: randomUUID(), requestFingerprint: "QA249", uploadedById: director.id,
    fileName: "QA249.pdf", mimeType: "application/pdf", size: 1, contentHash: "qa249", storageKey: `qa249/${run}`,
    storageMode: "local", state: "READY", stage: "SIGNED", readyAt: new Date(),
  } });
  const posted = await createLogisticsPostingCore(director.id, { tripId: trip.tripId, expectedRevision: trip.revision,
    clientMutationId: randomUUID(), amount: "0.02", currency: "USD", rate: 1.5, rateDate: "2026-11-20",
    cashAccountId: account.id, documentIds: [document.id] }, "post", { db: tx, transaction });
  const originalPosting = await tx.logisticsPosting.findUniqueOrThrow({ where: { id: posted.postingId } });
  const funds = async () => (await Promise.all([readCashBalance(tx, account.id), readOrgBalance(tx, "1")])).map(value => value.toFixed(2));
  const before = await funds();
  const version = { tripId: trip.tripId, postingId: posted.postingId, revision: posted.revision };
  const same = await redistributeTripInTransaction(tx, accountant.id, { ...version, ...original, requestId: randomUUID() });
  assert.equal(same.noOp, true);
  const input = { ...version, requestId: randomUUID(), shares: [
    { projectId: a.project.id, percentBps: 5000 }, { projectId: b.project.id, percentBps: 5000 },
  ], lines: [...original.lines, { projectId: b.project.id, kind: "PRODUCT" as const, productId: b.product.id, quantity: 1 }] };
  await assert.rejects(() => redistributeTripInTransaction(tx, procurement.id, input), /Недостаточно прав/);
  await assert.rejects(() => prepareReallocation(tx, accountant.id, { ...input,
    lines: [original.lines[0], { ...input.lines[1], productId: a.product.id }] }), /не принадлежит/);
  const preview = await prepareReallocation(tx, accountant.id, input);
  assert.equal(preview.split.difference, "-0.01");
  const revised = await redistributeTripInTransaction(tx, accountant.id, input);
  assert.equal(revised.revision, posted.revision + 1);
  assert.deepEqual(await funds(), before);
  const current = await tx.logisticsPosting.findUniqueOrThrow({ where: { id: revised.postingId }, include: { allocations: true, documents: true } });
  assert.deepEqual(current.documents.map(row => row.documentId), [document.id]);
  assert.equal(current.reallocatedFromId, posted.postingId);
  assert.equal(current.ttnNotRequired, originalPosting.ttnNotRequired);
  assert.equal(current.rate.toString(), originalPosting.rate.toString());
  assert.equal(current.paidAt.toISOString(), originalPosting.paidAt.toISOString());
  assert.equal(current.bynAmount.toFixed(2), "0.03");
  assert.equal(current.allocations.length, 2);
  assert.equal((await redistributeTripInTransaction(tx, accountant.id, input)).postingId, revised.postingId);
  await assert.rejects(() => redistributeTripInTransaction(tx, accountant.id, { ...input, requestId: randomUUID() }), /Рейс уже изменён/);
  const journal = await tx.changeLog.findFirstOrThrow({ where: { entityId: revised.postingId, action: "redistribute" } });
  const undo = { entryId: journal.id, requestId: randomUUID(), scope: { kind: "project", id: a.project.id } };
  await previewJournalReversalInTransaction(tx, director.id, undo);
  const reversed = await reverseJournalActionInTransaction(tx, director.id, undo);
  assert.equal((await reverseJournalActionInTransaction(tx, director.id, undo)).reversalId, reversed.reversalId);
  const restored = await tx.logisticsPosting.findFirstOrThrow({ where: { tripId: trip.tripId, status: "ACTIVE" }, include: { allocations: true } });
  assert.equal(restored.tripRevision, posted.revision + 2);
  assert.deepEqual(restored.allocations.map(row => [row.projectId, row.percentBps, row.amount.toFixed(2), row.bynAmount.toFixed(2)]),
    [[a.project.id, 10000, "0.02", "0.03"]]);
  assert.equal(await tx.payment.count({ where: { ...activePaymentWhere, direction: "EXPENSE", cashAccountId: account.id } }), 1);
  assert.deepEqual(await funds(), before);
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
  await tx.$executeRaw`SAVEPOINT qa249_strict_posting`;
  try {
    await assert.rejects(async () => {
      const { id: ignoredId, allocations, documents, ...copy } = current;
      assert.equal(ignoredId, revised.postingId);
      const clone = await tx.logisticsPosting.create({ data: {
        ...copy, id: randomUUID(), reallocatedFromId: null, status: "SUPERSEDED", tripRevision: restored.tripRevision + 1,
        clientMutationId: randomUUID(), manifestSnapshot: copy.manifestSnapshot as Prisma.InputJsonValue,
      } });
      await tx.logisticsPostingDocument.createMany({ data: documents.map(row => ({ ...row, postingId: clone.id })) });
      for (const row of allocations) {
        const allocation = await tx.logisticsPostingAllocation.create({ data: { ...row, id: randomUUID(), postingId: clone.id } });
        const payment = await tx.payment.findUniqueOrThrow({ where: { logisticsAllocationId: row.id } });
        await tx.payment.create({ data: { ...payment, id: randomUUID(), logisticsAllocationId: allocation.id } });
      }
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    }, /LOGISTICS_POSTING_PAYMENT_MISMATCH/);
  } finally {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT qa249_strict_posting`;
    await tx.$executeRaw`RELEASE SAVEPOINT qa249_strict_posting`;
  }
  return { centsPreserved: true, noOp: true, replay: true, stale: true, roles: true, ownership: true, undo: true };
}
