import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { createLogisticsTripCore, updateLogisticsTripCore, type LogisticsTransaction } from "../../src/server/logistics/core";
import { createLogisticsPostingCore } from "../../src/server/logistics/posting-core";
import { deleteLogisticsTripCore } from "../../src/server/logistics/delete-core";
import { createLogisticsDocumentService } from "../../src/server/logistics/documents";
import { getLogisticsTripCore, listLogisticsTripsCore } from "../../src/server/logistics/query-core";
import { getLogisticsProjectBudgetCore, getLogisticsTripMoneyCore } from "../../src/server/logistics/money-query-core";
import { readCashBalance, readOrgBalance } from "../../src/server/payroll/cash-core";
import { getProjectEconomics } from "../../src/server/finance/queries";
import { loadCashStatement } from "../../src/server/finance/cash-statement";
import { activePaymentWhere } from "../../src/server/payments/active-records";
import { nativeSnapshot } from "./native-acceptance-snapshot";

type Context = { adminId: string; projectIds: [string, string]; productIds: [string, string]; cashAccountId: string; currency: "BYN" | "USD" };

/** Собственные сущности; caller обязан обеспечить guarded rollback и общий денежный lock. Storage здесь injected. */
export async function verifyLogisticsTripDeletionNative(tx: Prisma.TransactionClient, context: Context) {
  let sequence = 0;
  const transaction: LogisticsTransaction = async operation => {
    const name = `logistics198_${++sequence}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
    try {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      const result = await operation(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error;
    }
  };
  const rejected = async (operation: () => Promise<unknown>, pattern: RegExp) => {
    const before = await nativeSnapshot(tx);
    await assert.rejects(operation, pattern);
    assert.deepEqual(await nativeSnapshot(tx), before, "DELETION_FAILURE_CHANGED_DATA");
  };
  const manifest = { date: "2026-10-29", comment: `QA198 ${context.currency}`, shares: context.projectIds.map((projectId, i) => ({ projectId, percentBps: i ? 6000 : 4000 })),
    lines: context.projectIds.map((projectId, i) => ({ projectId, kind: "PRODUCT" as const, productId: context.productIds[i], quantity: 1 })) };
  const trip = await createLogisticsTripCore(context.adminId, { ...manifest, clientMutationId: randomUUID() }, transaction);
  const other = await createLogisticsTripCore(context.adminId, { ...manifest, clientMutationId: randomUUID() }, transaction);
  const otherBefore = await tx.logisticsTrip.findUniqueOrThrow({ where: { id: other.tripId } });
  const documents = createLogisticsDocumentService({ transaction, storage: { mode: () => "local", put: async () => {}, open: async () => { throw Error("DELETED_STORAGE_READ"); } } });
  const document = await documents.upload(context.adminId, { tripId: trip.tripId, clientMutationId: randomUUID(), stage: "ISSUED",
    fileName: "QA198.pdf", mimeType: "application/pdf", ttnNumber: "QA198", bytes: Buffer.from("%PDF QA198") });
  const cashBefore = await readCashBalance(tx, context.cashAccountId), orgBefore = await readOrgBalance(tx, "1");
  const input = { tripId: trip.tripId, expectedRevision: trip.revision, clientMutationId: randomUUID(), amount: "10.00", currency: context.currency,
    cashAccountId: context.cashAccountId, documentIds: [document.document.id], ...(context.currency === "USD" ? { rate: 3, rateDate: "2026-10-29" } : {}) };
  const dependencies = { db: tx, transaction };
  const posted = await createLogisticsPostingCore(context.adminId, input, "post", dependencies);
  const corrected = await createLogisticsPostingCore(context.adminId, { ...input, amount: "12.00", expectedRevision: posted.revision, clientMutationId: randomUUID() }, "correct", dependencies);
  const request = { tripId: trip.tripId, expectedRevision: corrected.revision, clientMutationId: randomUUID() };
  const projectionBefore = await Promise.all(context.projectIds.map(id => getProjectEconomics(id, tx)));
  assert.ok(projectionBefore.every(row => row && row.expensesTotal! > 0));
  for (const role of ["DIRECTOR", "PROCUREMENT", "ACCOUNTANT", "MANAGER", "ENGINEER", "WORKER", "MOUNTER", "WORK_COORDINATOR"] as Role[]) {
    await tx.user.update({ where: { id: context.adminId }, data: { roles: [role] } });
    await rejected(() => deleteLogisticsTripCore(context.adminId, request, transaction), /администратор|прав/);
  }
  await tx.user.update({ where: { id: context.adminId }, data: { roles: ["ADMIN"], active: false } });
  await rejected(() => deleteLogisticsTripCore(context.adminId, request, transaction), /прав/);
  await tx.user.update({ where: { id: context.adminId }, data: { active: true } });
  await rejected(() => deleteLogisticsTripCore(context.adminId, { ...request, expectedRevision: 1 }, transaction), /изменён/);
  const fault = new Proxy(tx, { get(target, key) {
    if (key === "changeLog") return new Proxy(target.changeLog, { get(delegate, method) {
      return method === "create" ? () => { throw Error("QA198_AUDIT_FAILURE"); } : Reflect.get(delegate, method);
    } });
    return Reflect.get(target, key);
  } });
  await rejected(() => deleteLogisticsTripCore(context.adminId, request, operation => transaction(() => operation(fault))), /QA198_AUDIT_FAILURE/);
  const revoked = new Proxy(tx, { get(target, key) {
    if (key === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const result = await target.$queryRaw(strings, ...values);
      if (strings.join("").includes("18441")) await target.user.update({ where: { id: context.adminId }, data: { roles: ["DIRECTOR"] } });
      return result;
    };
    return Reflect.get(target, key);
  } });
  await rejected(() => deleteLogisticsTripCore(context.adminId, request, operation => transaction(() => operation(revoked))), /администратор/);
  const stored = await tx.logisticsTrip.findUniqueOrThrow({ where: { id: trip.tripId }, include: { shares: true, lines: true, documents: true } });
  const before = await nativeSnapshot(tx);
  const deleted = await deleteLogisticsTripCore(context.adminId, request, transaction);
  assert.equal(deleted.revision, corrected.revision + 1);
  assert.equal((await readCashBalance(tx, context.cashAccountId)).toFixed(2), cashBefore.toFixed(2));
  assert.equal((await readOrgBalance(tx, "1")).toFixed(2), orgBefore.toFixed(2));
  const after = await nativeSnapshot(tx);
  for (const [table, rows] of Object.entries(before.snapshot.rows)) if (!["LogisticsTrip", "LogisticsMutation", "ChangeLog", "DomainEvent"].includes(table))
    assert.deepEqual(after.snapshot.rows[table], rows, `DELETION_CHANGED_STORED_${table}`);
  assert.deepEqual(await tx.logisticsTrip.findUniqueOrThrow({ where: { id: other.tripId } }), otherBefore, "OTHER_TRIP_CHANGED");
  const retained = await tx.logisticsTrip.findUniqueOrThrow({ where: { id: trip.tripId }, include: { shares: true, lines: true, documents: true } });
  assert.deepEqual([retained.shares, retained.lines, retained.documents], [stored.shares, stored.lines, stored.documents]);
  assert.equal(retained.deletedById, context.adminId);
  assert.equal(retained.deletedAt?.toISOString(), deleted.deletedAt);
  assert.equal(await getLogisticsTripCore(context.adminId, trip.tripId, transaction), null);
  assert.equal((await listLogisticsTripsCore(context.adminId, { query: trip.tripId }, transaction)).total, 0);
  assert.equal(await documents.read(context.adminId, document.document.id), null);
  for (const id of context.projectIds) {
    assert.equal((await getLogisticsProjectBudgetCore(context.adminId, id, tx)).spent, 0);
    assert.equal((await getProjectEconomics(id, tx))?.expensesTotal, 0);
    assert.equal((await listLogisticsTripsCore(context.adminId, { projectId: id, query: trip.tripId }, transaction)).total, 0);
  }
  assert.equal(await tx.payment.count({ where: { ...activePaymentWhere, logisticsAllocation: { posting: { tripId: trip.tripId } } } }), 0);
  const actor = await tx.user.findUniqueOrThrow({ where: { id: context.adminId }, select: { id: true, name: true, roles: true } });
  const statement = await loadCashStatement(actor, { from: "2000-01-01", to: "2099-12-31", mode: "NATIVE" }, tx);
  assert.equal(statement.rows.find(row => row.id === context.cashAccountId)?.totals.closing, cashBefore.toFixed(2));
  const replayBefore = await nativeSnapshot(tx);
  assert.equal((await deleteLogisticsTripCore(context.adminId, request, transaction)).repeated, true);
  assert.deepEqual(await nativeSnapshot(tx), replayBefore, "DELETION_REPLAY_WRITES");
  await rejected(() => deleteLogisticsTripCore(context.adminId, { ...request, expectedRevision: request.expectedRevision + 1 }, transaction), /другими данными/);
  await rejected(() => updateLogisticsTripCore(context.adminId, { ...manifest, tripId: trip.tripId, expectedRevision: deleted.revision, clientMutationId: randomUUID() }, transaction), /Рейс не найден/);
  await rejected(() => createLogisticsPostingCore(context.adminId, { ...input, expectedRevision: deleted.revision, clientMutationId: randomUUID() }, "post", dependencies), /Рейс не найден/);
  await assert.rejects(getLogisticsTripMoneyCore(context.adminId, trip.tripId, tx), /Рейс не найден/);
  const beforeUnpaid = await readCashBalance(tx, context.cashAccountId);
  await deleteLogisticsTripCore(context.adminId, { tripId: other.tripId, expectedRevision: other.revision, clientMutationId: randomUUID() }, transaction);
  assert.equal((await readCashBalance(tx, context.cashAccountId)).toFixed(2), beforeUnpaid.toFixed(2));
  const racing = await createLogisticsTripCore(context.adminId, { ...manifest, clientMutationId: randomUUID() }, transaction);
  const racingDocuments = createLogisticsDocumentService({ transaction, storage: { mode: () => "local", open: async () => null, put: async () => {
    await deleteLogisticsTripCore(context.adminId, { tripId: racing.tripId, expectedRevision: racing.revision, clientMutationId: randomUUID() }, transaction);
  } } });
  const racingId = randomUUID();
  await assert.rejects(racingDocuments.upload(context.adminId, { tripId: racing.tripId, clientMutationId: racingId, stage: "ISSUED",
    fileName: "QA198-race.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF RACE") }), /Рейс не найден/);
  assert.equal((await tx.logisticsDocument.findUniqueOrThrow({ where: { clientMutationId: racingId } })).state, "PENDING");
  await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
  await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
  return { currency: context.currency, adminOnly: true, revokedDuringLock: true, correctedHistoryRetained: true, cashAndOrgRestored: true,
    economicsAndStatement: true, originalRowsRetained: true, otherTripPreserved: true, replay: true, auditFailureRollback: true,
    deletedReadsAndWritesDenied: true, uploadPhaseRace: true, unpostedNoMoneyChange: true };
}
