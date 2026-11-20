import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { createLogisticsTripCore, updateLogisticsTripCore } from "../../src/server/logistics/core";
import { deleteLogisticsTripCore } from "../../src/server/logistics/delete-core";
import { createLogisticsDocumentService } from "../../src/server/logistics/documents";
import { createLogisticsPostingCore } from "../../src/server/logistics/posting-core";
import { getLogisticsTripCore } from "../../src/server/logistics/query-core";
import { getLogisticsTripMoneyCore } from "../../src/server/logistics/money-query-core";
import { readCashBalance, readOrgBalance } from "../../src/server/payroll/cash-core";

/** Только caller-owned rollback-only транзакция и подставное хранилище. */
export async function verifyLogisticsLifecycleNative(tx: Prisma.TransactionClient) {
  const run = randomUUID();
  const user = (label: string, roles: Role[]) => tx.user.create({ data: { name: label, email: `${run}-${label}@example.invalid`,
    passwordHash: "QA260_NO_LOGIN", roles } });
  const [admin, director, procurement] = await Promise.all([
    user("qa260-admin", ["ADMIN"]), user("qa260-director", ["DIRECTOR"]), user("qa260-procurement", ["PROCUREMENT"]),
  ]);
  const client = await tx.client.create({ data: { name: "Проверка №260", phone: "QA260" } });
  const numberInt = 1_500_000_000 + Number.parseInt(run.slice(0, 7), 16);
  async function lineFor(number: number) {
    const project = await tx.project.create({ data: { title: "Проверка №260", clientId: client.id,
      numberInt: number, number: String(number), currency: "BYN" } });
    const product = await tx.product.create({ data: { projectId: project.id, title: "Проверка №260", number: `${number}.1`,
      suffixInt: 1, status: "PRODUCTION" } });
    return { projectId: project.id, kind: "PRODUCT" as const, productId: product.id, quantity: 1 };
  }
  const a = await lineFor(numberInt), b = await lineFor(numberInt + 1);
  const initial = { date: "2026-11-20", comment: "Рейс №260", ttnNotRequired: false, lines: [a, b], shares: [
    { projectId: a.projectId, percentBps: 5000 }, { projectId: b.projectId, percentBps: 5000 },
  ] };
  const single = { ...initial, lines: [a], shares: [{ projectId: a.projectId, percentBps: 10000 }] };
  const transaction = async <T>(operation: (db: Prisma.TransactionClient) => Promise<T>) => operation(tx);
  const undo = (entryId: string, requestId = randomUUID()) => reverseJournalActionInTransaction(tx, director.id, { entryId, requestId, scope: { kind: "global" } });
  const trip = await createLogisticsTripCore(procurement.id, { ...initial, clientMutationId: randomUUID() }, transaction);
  const draft = await createLogisticsTripCore(procurement.id, { ...single, clientMutationId: randomUUID() }, transaction);
  const creation = await tx.changeLog.findFirstOrThrow({ where: { entityId: draft.tripId, action: "create" } });
  await assert.rejects(() => reverseJournalActionInTransaction(tx, procurement.id, { entryId: creation.id, requestId: randomUUID(), scope: { kind: "global" } }), /Недостаточно прав/);
  const cancelledDraft = await undo(creation.id);
  assert.equal(await getLogisticsTripCore(director.id, draft.tripId, transaction), null);
  await undo(cancelledDraft.reversalId);
  assert.ok(await getLogisticsTripCore(director.id, draft.tripId, transaction));

  const originalB = await tx.logisticsShipmentLine.findFirstOrThrow({ where: { tripId: trip.tripId, projectId: b.projectId } });
  const editId = randomUUID();
  const edit = await updateLogisticsTripCore(procurement.id,
    { ...single, tripId: trip.tripId, expectedRevision: trip.revision, clientMutationId: editId }, transaction);
  const removed = await tx.logisticsShipmentLine.findUniqueOrThrow({ where: { id: originalB.id } });
  assert.ok(removed.removedAt);
  const active = await getLogisticsTripCore(director.id, trip.tripId, transaction);
  assert.ok(active?.mode === "manage");
  assert.equal(active.lines.length, 1);
  assert.equal(active.shares.length, 1);
  assert.equal(active.revision, edit.revision);
  await undo(`logistics-mutation:${editId}`);
  assert.equal((await tx.logisticsShipmentLine.findUniqueOrThrow({ where: { id: originalB.id } })).removedAt, null);

  let writes = 0;
  const service = createLogisticsDocumentService({ transaction, storage: { mode: () => "local",
    put: async () => { writes++; }, open: async () => new ReadableStream() } });
  const uploadInput = { tripId: trip.tripId, clientMutationId: randomUUID(), stage: "SIGNED" as const,
    fileName: "qa260.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF") };
  const uploaded = await service.upload(procurement.id, uploadInput);
  const documentId = uploaded.document.id;
  const hidden = await undo(`logistics-document:${documentId}`);
  assert.equal(await service.read(director.id, documentId), null);
  assert.deepEqual(await service.list(director.id, trip.tripId), []);
  await assert.rejects(() => service.upload(procurement.id, uploadInput), /Загрузка отменена/);
  await undo(hidden.reversalId);
  assert.deepEqual((await service.list(director.id, trip.tripId)).map(document => document.id), [documentId]);
  assert.equal(writes, 1);
  const account = await tx.cashAccount.create({ data: { name: `QA260 USD ${run}`, currency: "USD" } });
  const other = await tx.cashAccount.create({ data: { name: `QA260 BYN ${run}`, currency: "BYN" } });
  const income = await tx.payment.create({ data: { direction: "INCOME", amount: "1.00", rate: "1.50", bynAmount: "1.50",
    currency: "USD", cashAccountId: account.id } });
  await tx.payment.create({ data: { direction: "INCOME", amount: "50.00", bynAmount: "50.00", currency: "BYN", cashAccountId: other.id } });
  const before = await readOrgBalance(tx, "1");
  const currentRevision = async () => (await tx.logisticsTrip.findUniqueOrThrow({ where: { id: trip.tripId } })).revision;
  const postId = randomUUID();
  const posted = await createLogisticsPostingCore(director.id, { tripId: trip.tripId, expectedRevision: await currentRevision(),
    clientMutationId: postId, amount: "0.02", currency: "USD", rate: 1.5, rateDate: initial.date,
    cashAccountId: account.id, documentIds: [documentId] }, "post", { db: tx, transaction });
  const child = await tx.changeLog.findFirstOrThrow({ where: { operationRootId: `logistics-posting:${postId}`, entity: "payment" } });
  await previewJournalReversalInTransaction(tx, director.id, { entryId: child.id, scope: { kind: "global" } });
  const undoPost = await undo(child.id);
  assert.equal((await getLogisticsTripMoneyCore(director.id, trip.tripId, tx)).current, null);
  assert.ok((await readOrgBalance(tx, "1")).eq(before));
  await undo(undoPost.reversalId);
  const restoredFirst = (await getLogisticsTripMoneyCore(director.id, trip.tripId, tx)).current;
  assert.equal(restoredFirst?.bynAmount, "0.04");
  assert.deepEqual(restoredFirst?.documentIds, [documentId]);

  const correctionId = randomUUID();
  await createLogisticsPostingCore(director.id, { tripId: trip.tripId, expectedRevision: await currentRevision(),
    clientMutationId: correctionId, amount: "12.00", currency: "BYN", cashAccountId: other.id,
    documentIds: [documentId], manifest: single }, "correct", { db: tx, transaction });
  const undoCorrection = `logistics-posting:${correctionId}`;
  await tx.payment.update({ where: { id: income.id }, data: { deletedAt: new Date(), deletedById: admin.id } });
  await assert.rejects(() => previewJournalReversalInTransaction(tx, director.id, { entryId: undoCorrection, scope: { kind: "global" } }), /отрицательный остаток кассы/);
  await assert.rejects(() => undo(undoCorrection), /отрицательный остаток кассы/);
  assert.equal((await getLogisticsTripMoneyCore(director.id, trip.tripId, tx)).current?.amount, "12.00");
  await tx.payment.update({ where: { id: income.id }, data: { deletedAt: null, deletedById: null } });
  const requestId = randomUUID();
  const reversal = await undo(undoCorrection, requestId);
  assert.equal((await undo(undoCorrection, requestId)).reversalId, reversal.reversalId);
  const history = await getLogisticsTripMoneyCore(director.id, trip.tripId, tx);
  assert.equal(history.history.length, 3);
  assert.equal(history.current?.amount, "0.02");
  assert.deepEqual(history.current?.allocations.map(row => row.bynAmount), ["0.02", "0.02"]);
  assert.deepEqual(history.current?.documentIds, [documentId]);
  assert.equal((await readCashBalance(tx, account.id)).toFixed(2), "0.98");
  assert.equal((await readCashBalance(tx, other.id)).toFixed(2), "50.00");
  assert.equal((await tx.logisticsPosting.findUniqueOrThrow({ where: { id: posted.postingId } })).status, "SUPERSEDED");
  assert.equal((await tx.logisticsShipmentLine.findUniqueOrThrow({ where: { id: originalB.id } })).removedAt, null);
  await assert.rejects(() => undo((hidden.reversalId)), /уже отменено/);
  const reShown = await tx.changeLog.findUniqueOrThrow({ where: { reversesId: hidden.reversalId } });
  await assert.rejects(() => undo(reShown.id),
    /закреплена за исторической проводкой/);

  const deletionId = randomUUID();
  await deleteLogisticsTripCore(admin.id, { tripId: trip.tripId, expectedRevision: await currentRevision(),
    clientMutationId: deletionId }, transaction);
  assert.equal((await readCashBalance(tx, account.id)).toFixed(2), "1.00");
  await undo(`logistics-delete:${deletionId}`);
  assert.equal((await readCashBalance(tx, account.id)).toFixed(2), "0.98");
  assert.equal((await getLogisticsTripMoneyCore(director.id, trip.tripId, tx)).current?.id, history.current?.id);
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
  return { softManifest: true, documentRetention: true, groupedPosting: true, bothCurrencies: true, replay: true };
}
