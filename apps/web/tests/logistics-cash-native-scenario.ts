import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type Role } from "@prisma/client";
import { createLogisticsTripCore, updateLogisticsTripCore, type LogisticsTransaction } from "../src/server/logistics/core";
import { createLogisticsDocumentService, type LogisticsDocumentStorage } from "../src/server/logistics/documents";
import { createLogisticsPostingCore } from "../src/server/logistics/posting-core";
import { getLogisticsProjectBudgetCore, getLogisticsTripMoneyCore } from "../src/server/logistics/money-query-core";
import { createPaymentInTransaction } from "../src/server/payments/transaction";
import { preparePayment } from "../src/server/payments/prepare";
import { deletePaymentInTransaction } from "../src/server/payments/delete-core";
import { activePaymentWhere } from "../src/server/payments/active-records";
import { readCashBalance, readOrgBalance } from "../src/server/payroll/cash-core";
import { allocateLogisticsMoney } from "../src/server/logistics/allocation";

/** Общий сценарий local/staging. Caller обязан проверить цель и откатить внешнюю QA-транзакцию. */
export async function runLogisticsCashAcceptance(tx: Prisma.TransactionClient) {
  let checkpoint = 0;
  const transaction: LogisticsTransaction = async operation => {
    const savepoint = `qa124_${++checkpoint}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
    try {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const result = await operation(tx);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  };
  const originalCounts = { payments: await tx.payment.count(), trips: await tx.logisticsTrip.count(), postings: await tx.logisticsPosting.count() };
  const products = await tx.product.findMany({ where: { deletedAt: null, status: { not: "DRAFT" }, project: { deletedAt: null, currency: "BYN" } },
    select: { id: true, projectId: true }, orderBy: { id: "asc" } });
  const a = products[0], b = products.find(row => row.projectId !== a?.projectId);
  assert.ok(a && b, "TWO_EXISTING_LIVE_BYN_PROJECTS_REQUIRED");
  const marker = `qa124-${randomUUID()}`, actorId = randomUUID(), accountantId = randomUUID();
  for (const [id, role] of [[actorId, "PROCUREMENT"], [accountantId, "ACCOUNTANT"]] as [string, Role][])
    await tx.user.create({ data: { id, name: marker, email: `${id}@invalid.local`, passwordHash: "qa-login-disabled", roles: [role] } });
  const actor = { id: actorId, name: marker, roles: ["PROCUREMENT"] as Role[], source: "web" as const };
  const account = await tx.cashAccount.create({ data: { id: randomUUID(), name: marker, currency: "BYN" } });
  const smallAccount = await tx.cashAccount.create({ data: { id: randomUUID(), name: `${marker}-empty`, currency: "BYN" } });
  const maxCode = (await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0;
  const article = await tx.expenseArticle.create({ data: { id: randomUUID(), code: maxCode + 1, name: "Логистика", comment: marker } });
  const beforeFunding = await readOrgBalance(tx, "1.000000");
  const funding = Prisma.Decimal.max(5000, beforeFunding.negated().plus(5000)).toNumber();
  const income = { clientMutationId: "00000134-0000-4000-8000-000000000106", direction: "INCOME" as const, amount: funding, currency: "BYN", cashAccountId: account.id, paidAt: "2026-10-10" };
  await transaction(async current => createPaymentInTransaction(actor, income, await preparePayment(income, current), current));
  const report = await tx.financeDocument.create({ data: { clientMutationId: randomUUID(), requestFingerprint: marker, uploadedById: actorId,
    fileName: "qa124-report.pdf", mimeType: "application/pdf", size: 20, contentHash: marker, storageKey: `qa124/${marker}/report`, storageMode: "local", state: "READY", readyAt: new Date() } });
  const other = { clientMutationId: "00000134-0000-4000-8000-000000000107", direction: "EXPENSE" as const, projectId: a.projectId, amount: 50, currency: "BYN", cashAccountId: account.id,
    expenseArticleId: article.id, reportDocumentId: report.id, paidAt: "2026-10-10" };
  await transaction(async current => createPaymentInTransaction(actor, other, await preparePayment(other, current), current));
  await assert.rejects(transaction(async current => createPaymentInTransaction(actor, { ...other, clientMutationId: "00000134-0000-4000-8000-000000000108", reportDocumentId: undefined }, await preparePayment(other, current), current)), /отчетный документ/);
  await assert.rejects(preparePayment({ ...other, expenseArticleId: undefined }, tx), /статью расхода/);
  const manifest = { date: "2026-10-10", comment: marker,
    shares: [{ projectId: a.projectId, percentBps: 4000 }, { projectId: b.projectId, percentBps: 6000 }],
    lines: [{ projectId: a.projectId, kind: "PRODUCT" as const, productId: a.id, quantity: 2 },
      { projectId: b.projectId, kind: "PRODUCT" as const, productId: b.id, quantity: 3 }] };
  const trip = await createLogisticsTripCore(actorId, { ...manifest, clientMutationId: randomUUID() }, transaction);
  const contents = new Map<string, Buffer>();
  const storage: LogisticsDocumentStorage = { mode: () => "local", async put(document, bytes) { contents.set(document.storageKey, bytes); },
    async open(document) { const bytes = contents.get(document.storageKey); return bytes ? new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) : null; } };
  const documents = createLogisticsDocumentService({ transaction, storage });
  const upload = { tripId: trip.tripId, clientMutationId: randomUUID(), stage: "ISSUED" as const, ttnNumber: marker,
    fileName: "ТТН.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nQA124") };
  const input = { tripId: trip.tripId, expectedRevision: trip.revision, clientMutationId: randomUUID(), amount: "1000.00",
    currency: "BYN" as const, cashAccountId: account.id, documentIds: [randomUUID()] as string[] };
  const dependencies = { db: tx, transaction };
  await assert.rejects(createLogisticsPostingCore(actorId, input, "post", dependencies), /сохранённая ТТН/);
  const ready = await documents.upload(actorId, upload);
  input.documentIds = [ready.document.id];
  const initialCash = await readCashBalance(tx, account.id), initialOrg = await readOrgBalance(tx, "1.000000");
  const posted = await createLogisticsPostingCore(actorId, input, "post", dependencies);
  const first = await getLogisticsTripMoneyCore(actorId, trip.tripId, tx);
  assert.equal((await tx.logisticsPosting.findUniqueOrThrow({ where: { id: posted.postingId } })).expenseArticleId, null);
  assert.ok((await tx.payment.findMany({ where: { logisticsAllocation: { postingId: posted.postingId } }, select: { expenseArticleId: true } })).every(row => row.expenseArticleId === null));
  assert.deepEqual(first.current!.allocations.map(row => [row.projectId, row.amount]).sort(), [[a.projectId, "400.00"], [b.projectId, "600.00"]].sort());
  assert.equal((await readCashBalance(tx, account.id)).toFixed(2), initialCash.minus(1000).toFixed(2));
  assert.equal((await readOrgBalance(tx, "1.000000")).toFixed(2), initialOrg.minus(1000).toFixed(2));
  const paymentsAfterPost = await tx.payment.count(), eventsAfterPost = await tx.domainEvent.count();
  assert.equal((await createLogisticsPostingCore(actorId, input, "post", dependencies)).postingId, posted.postingId);
  assert.equal(await tx.payment.count(), paymentsAfterPost); assert.equal(await tx.domainEvent.count(), eventsAfterPost);
  await assert.rejects(createLogisticsPostingCore(actorId, { ...input, amount: "1001.00" }, "post", dependencies), /другими данными/);
  await assert.rejects(createLogisticsPostingCore(accountantId, { ...input, clientMutationId: randomUUID() }, "correct", dependencies), /Недостаточно прав/);
  await assert.rejects(updateLogisticsTripCore(actorId, { ...manifest, tripId: trip.tripId, expectedRevision: posted.revision, clientMutationId: randomUUID() }, transaction), /Рейс оплачен/);
  const originalPayments = first.current!.allocations.map(row => row.paymentId!);
  await assert.rejects(transaction(current => deletePaymentInTransaction(actor, originalPayments[0], "EXPENSE", "BYN", "1.000000", current)), /общий рейс/);
  await assert.rejects(transaction(current => current.payment.update({ where: { id: originalPayments[0] }, data: { amount: 1 } })), /IMMUTABLE/);
  await assert.rejects(transaction(current => current.logisticsDocument.delete({ where: { id: ready.document.id } })), /IMMUTABLE/);
  const budgetBefore = await getLogisticsProjectBudgetCore(actorId, a.projectId, tx);
  assert.equal(budgetBefore.tripSpent, 400); assert.equal(budgetBefore.spent, 400);
  assert.equal(budgetBefore.remaining, budgetBefore.deliveryBudget === null ? null : new Prisma.Decimal(budgetBefore.deliveryBudget).minus(400).toNumber());
  const correction = { ...input, amount: "1200.00", expectedRevision: posted.revision, clientMutationId: randomUUID() };
  await assert.rejects(createLogisticsPostingCore(actorId, { ...correction, cashAccountId: smallAccount.id }, "correct", dependencies), /Недостаточно средств/);
  assert.equal((await getLogisticsTripMoneyCore(actorId, trip.tripId, tx)).current!.id, posted.postingId);
  const incomeCount = await tx.payment.count({ where: { direction: "INCOME" } });
  const corrected = await createLogisticsPostingCore(actorId, correction, "correct", dependencies);
  const state = await getLogisticsTripMoneyCore(actorId, trip.tripId, tx);
  assert.deepEqual(state.current!.allocations.map(row => [row.projectId, row.amount]).sort(), [[a.projectId, "480.00"], [b.projectId, "720.00"]].sort());
  assert.equal(state.history.length, 1); assert.equal(state.history[0].status, "SUPERSEDED");
  assert.deepEqual(state.history[0].allocations.map(row => row.amount).sort(), ["400.00", "600.00"]);
  assert.equal((await readCashBalance(tx, account.id)).toFixed(2), initialCash.minus(1200).toFixed(2));
  assert.equal((await readOrgBalance(tx, "1.000000")).toFixed(2), initialOrg.minus(1200).toFixed(2));
  assert.equal(await tx.payment.count({ where: { direction: "INCOME" } }), incomeCount);
  assert.equal(await tx.payment.count({ where: { AND: [activePaymentWhere, { id: { in: originalPayments } }] } }), 0);
  const activeTotal = await tx.payment.aggregate({ where: { AND: [activePaymentWhere, { logisticsAllocation: { posting: { tripId: trip.tripId } } }] }, _sum: { amount: true } });
  assert.equal(activeTotal._sum.amount!.toFixed(2), "1200.00");
  await assert.rejects(createLogisticsPostingCore(actorId, { ...correction, clientMutationId: randomUUID() }, "correct", dependencies), /уже изменён/);
  await documents.upload(actorId, { ...upload, clientMutationId: randomUUID(), stage: "SIGNED", bytes: Buffer.from("%PDF-1.4\nSIGNED") });
  assert.equal((await getLogisticsTripMoneyCore(actorId, trip.tripId, tx)).current!.id, corrected.postingId);
  assert.equal((await tx.logisticsTrip.findUniqueOrThrow({ where: { id: trip.tripId } })).revision, corrected.revision);
  assert.ok(await documents.read(accountantId, ready.document.id));
  // Смена проектов не зависит от FK на mutable LogisticsProjectShare: оба старых снимка остаются.
  const oneProject = { ...manifest, shares: [{ projectId: b.projectId, percentBps: 10000 }], lines: [manifest.lines[1]] };
  const one = await createLogisticsPostingCore(actorId, { ...input, amount: "1200", expectedRevision: corrected.revision,
    clientMutationId: randomUUID(), manifest: oneProject }, "correct", dependencies);
  assert.equal(await tx.logisticsProjectShare.count({ where: { tripId: trip.tripId } }), 1);
  assert.equal((await getLogisticsTripMoneyCore(actorId, trip.tripId, tx)).history.length, 2);
  assert.equal((await getLogisticsProjectBudgetCore(actorId, a.projectId, tx)).spent, 0);
  assert.equal(one.revision, corrected.revision + 1);
  const fx = allocateLogisticsMoney("0.02", [{ projectId: a.projectId, percentBps: 5000 }, { projectId: b.projectId, percentBps: 5000 }], "2.5");
  assert.equal(fx.bynAmount, "0.06");
  await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
  return { assertions: "TTN, 1000=>400/600, no article dependency, project-only fact400, replay/CAS, correction1200=>480/720, immutable history, cash/org/budget, project replacement, signed, generic report/article policy",
    originalCounts, ownedMarker: marker };
}
