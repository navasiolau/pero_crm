import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createLogisticsTripCore, updateLogisticsTripCore, type LogisticsTransaction } from "../../src/server/logistics/core";
import { createLogisticsPostingCore } from "../../src/server/logistics/posting-core";
import { createLogisticsDocumentService } from "../../src/server/logistics/documents";
import { getLogisticsTripCore } from "../../src/server/logistics/query-core";
import { readCashBalance, readOrgBalance } from "../../src/server/payroll/cash-core";
import { nativeSnapshot } from "./native-acceptance-snapshot";

/** Только внутри существующей guarded rollback-транзакции с собственными QA-сущностями. */
export async function verifyLogisticsTtnWaiverNative(tx: Prisma.TransactionClient,
  context: { actorId: string; projectId: string; productId: string; cashAccountId: string }) {
  let sequence = 0;
  const transaction: LogisticsTransaction = async operation => {
    const name = `logistics197_${++sequence}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
    try { const result = await operation(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
    catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
  };
  const dependencies = { db: tx, transaction };
  const manifest = { date: "2026-10-29", comment: "QA197", shares: [{ projectId: context.projectId, percentBps: 10000 }],
    lines: [{ projectId: context.projectId, kind: "PRODUCT" as const, productId: context.productId, quantity: 1 }] };
  let trip = await createLogisticsTripCore(context.actorId, { ...manifest, clientMutationId: randomUUID() }, transaction);
  const input = () => ({ tripId: trip.tripId, expectedRevision: trip.revision, clientMutationId: randomUUID(),
    amount: "10.00", currency: "BYN", cashAccountId: context.cashAccountId, documentIds: [] as string[] });
  const rejected = async (operation: () => Promise<unknown>, pattern: RegExp) => {
    const before = await nativeSnapshot(tx);
    await assert.rejects(operation, pattern);
    assert.deepEqual(await nativeSnapshot(tx), before, "REJECTED_WAIVER_ZERO_WRITES");
  };
  await rejected(() => createLogisticsPostingCore(context.actorId, input(), "post", dependencies), /ТТН/);
  trip = await updateLogisticsTripCore(context.actorId, { ...manifest, tripId: trip.tripId, expectedRevision: trip.revision,
    clientMutationId: randomUUID(), ttnNotRequired: true }, transaction);
  trip = await updateLogisticsTripCore(context.actorId, { ...manifest, tripId: trip.tripId, expectedRevision: trip.revision,
    clientMutationId: randomUUID() }, transaction);
  const view = await getLogisticsTripCore(context.actorId, trip.tripId, transaction);
  assert.equal(view?.ttnNotRequired, true);
  const cashBefore = await readCashBalance(tx, context.cashAccountId), orgBefore = await readOrgBalance(tx, "1");
  const request = input(), posted = await createLogisticsPostingCore(context.actorId, request, "post", dependencies);
  const initial = await tx.logisticsPosting.findUniqueOrThrow({ where: { id: posted.postingId } });
  assert.equal(initial.ttnNotRequired, true);
  assert.equal((initial.manifestSnapshot as { ttnNotRequired: boolean }).ttnNotRequired, true);
  assert.equal((await readCashBalance(tx, context.cashAccountId)).toFixed(2), cashBefore.minus(10).toFixed(2));
  assert.equal((await readOrgBalance(tx, "1")).toFixed(2), orgBefore.minus(10).toFixed(2));
  const afterPost = await nativeSnapshot(tx);
  assert.equal((await createLogisticsPostingCore(context.actorId, request, "post", dependencies)).repeated, true);
  assert.deepEqual(await nativeSnapshot(tx), afterPost);
  trip = { ...trip, revision: posted.revision };
  await rejected(() => createLogisticsPostingCore(context.actorId, { ...input(), documentIds: [randomUUID()] }, "correct", dependencies), /ТТН/);
  await rejected(() => createLogisticsPostingCore(context.actorId, { ...input(), manifest: { ...manifest, ttnNotRequired: false } }, "correct", dependencies), /ТТН/);
  const correction = { ...input(), amount: "12.00", manifest }, corrected = await createLogisticsPostingCore(context.actorId, correction, "correct", dependencies);
  const current = await tx.logisticsPosting.findUniqueOrThrow({ where: { id: corrected.postingId } });
  assert.equal(current.ttnNotRequired, true, "OMITTED_CORRECTION_PRESERVES_WAIVER");
  assert.deepEqual(await tx.logisticsPosting.findUniqueOrThrow({ where: { id: initial.id } }), { ...initial, status: "SUPERSEDED" });
  await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
  await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
  await rejected(() => transaction(async db => {
    await db.logisticsPosting.update({ where: { id: current.id }, data: { ttnNotRequired: false } });
  }), /IMMUTABLE/);
  await rejected(() => transaction(async db => {
    const { id: oldId, ...copy } = current;
    const cloned = await db.logisticsPosting.create({ data: { ...copy, id: randomUUID(), status: "SUPERSEDED", tripRevision: current.tripRevision + 100,
      clientMutationId: randomUUID(), ttnNotRequired: false, manifestSnapshot: copy.manifestSnapshot as Prisma.InputJsonValue } });
    const source = await db.logisticsPostingAllocation.findFirstOrThrow({ where: { postingId: oldId }, include: { payment: true } });
    const allocation = await db.logisticsPostingAllocation.create({ data: { id: randomUUID(), postingId: cloned.id, projectId: source.projectId,
      projectNumberSnapshot: source.projectNumberSnapshot, percentBps: source.percentBps, amount: source.amount, bynAmount: source.bynAmount } });
    assert.ok(source.payment);
    await db.payment.create({ data: { ...source.payment, id: randomUUID(), logisticsAllocationId: allocation.id } });
    await db.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
  }), /LOGISTICS_POSTING_TTN_REQUIRED/);
  const beforeLate = (await readCashBalance(tx, context.cashAccountId)).toFixed(2);
  const documents = createLogisticsDocumentService({ transaction, storage: { mode: () => "local", put: async () => {}, open: async () => null } });
  await documents.upload(context.actorId, { tripId: trip.tripId, clientMutationId: randomUUID(), stage: "ISSUED",
    fileName: "QA197.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF QA197") });
  assert.equal((await readCashBalance(tx, context.cashAccountId)).toFixed(2), beforeLate, "LATE_TTN_NO_SECOND_EXPENSE");
  return { missingTtnDenied: true, savedWaiver: true, postingAndCorrection: true, replay: true, badDocumentDenied: true,
    immutableHistory: true, postgresTtnConstraint: true, lateDocumentNoExpense: true, storage: "injected" };
}
