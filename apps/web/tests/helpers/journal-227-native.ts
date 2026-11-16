import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { createPaymentInTransaction } from "../../src/server/payments/transaction";
import { paymentFingerprint, paymentReceiptId } from "../../src/server/payments/receipts";
import { createMaterialInTransaction } from "../../src/server/warehouse/material-core";
import { createLogisticsTripCore, updateLogisticsTripCore } from "../../src/server/logistics/core";
import { toggleExpenseArticleCore } from "../../src/server/finance/article-core";
import { parseJournalPresentation } from "../../src/server/changelog/presentation";
import { warehouseMove } from "../../src/server/warehouse/accounting";
import { warehouseMetadataGate } from "../../src/server/warehouse/gate";
import { deleteMovementInTransaction, previewMovementDeletionInTransaction } from "../../src/server/warehouse/deletion-core";
import { captureProductPercentageCompletion } from "../../src/server/product-percentage-pay/core";

/** Вызывается root только внутри уже проверенной rollback-only транзакции; не подключается к БД самостоятельно. */
export async function probe(tx: Prisma.TransactionClient) {
  const prefix = `qa-journal-227-${randomUUID()}`;
  const projectNumber = String(2_000_227_000 + randomInt(1000));
  assert.equal(await tx.project.count({ where: { number: projectNumber } }), 0, "QA номер уже занят");
  await tx.$executeRawUnsafe("SAVEPOINT journal_227_probe");
  try {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
    await warehouseMetadataGate(tx);
    const actor = { id: `${prefix}-actor`, name: `${prefix} Администратор`, roles: ["ADMIN"] as Role[], source: "web" as const };
    await tx.user.create({ data: { id: actor.id, name: actor.name, roles: actor.roles, email: `${prefix}@example.invalid`, passwordHash: "!qa-no-login" } });
    const client = await tx.client.create({ data: { id: `${prefix}-client`, name: `${prefix} Клиент`, phone: "+375000000000" } });
    const project = await tx.project.create({ data: { id: `${prefix}-project`, number: projectNumber, numberInt: Number(projectNumber),
      title: prefix, clientId: client.id, createdById: actor.id, currency: "BYN", stage: "CONTRACT" } });
    const product = await tx.product.create({ data: { id: `${prefix}-product`, number: `${projectNumber}.1`, suffixInt: 1,
      title: prefix, projectId: project.id, status: "DESIGN", quantity: 1, expectedPrice: 100 } });
    const account = await tx.cashAccount.create({ data: { id: `${prefix}-cash`, name: `${prefix} Касса`, currency: "BYN", comment: prefix } });
    const article = await tx.expenseArticle.create({ data: { id: `${prefix}-article`, name: prefix,
      code: ((await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1 } });
    const unit = await tx.materialUnit.create({ data: { id: `${prefix}-unit`, name: `${prefix}-шт` } });
    const category = await tx.materialCategory.create({ data: { id: `${prefix}-category`, name: `${prefix} Категория` } });

    const protectedPool = await tx.productStagePayPool.create({ data: { id: `${prefix}-pool`, productId: product.id,
      kind: "ENGINEERING", state: "SETTLED", ratePercent: 3, createdById: actor.id } });
    // Текущий SQL guard запрещает этот переход даже при неизменной причине; это не успешная операция без аудита.
    for (const [index, reason] of ["Ставка не задана при первом завершении", "Уже защищено прежним способом оплаты"].entries()) {
      await tx.$executeRawUnsafe("SAVEPOINT journal_227_protection_fixture");
      try {
        const skippedCompletion = await tx.productPercentageCompletion.create({ data: { id: `${prefix}-completion-${index}`, productId: product.id,
          kind: "ENGINEERING", state: "SKIPPED_ONCE", reason, statusAtCompletion: "PRODUCTION",
          productCurrency: "BYN", payrollCurrency: "BYN", calculationVersion: 1, completedById: actor.id } });
        const auditCount = await tx.changeLog.count({ where: { actorId: actor.id } });
        await tx.$executeRawUnsafe("SAVEPOINT journal_227_protection_failure");
        try {
          await assert.rejects(captureProductPercentageCompletion(tx, actor, product.id, "ENGINEERING", "PRODUCTION"),
            (error: unknown) => error instanceof Error && error.message.includes("P0001")
              && error.message.includes("product percentage completion inputs are immutable"));
        } finally {
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT journal_227_protection_failure");
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT journal_227_protection_failure");
        }
        assert.deepEqual(await tx.productPercentageCompletion.findUniqueOrThrow({ where: { id: skippedCompletion.id } }), skippedCompletion);
        assert.equal(await tx.changeLog.count({ where: { actorId: actor.id } }), auditCount);
        assert.deepEqual(await tx.productStagePayPool.findUniqueOrThrow({ where: { id: protectedPool.id } }), protectedPool);
        assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 0);
      } finally {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT journal_227_protection_fixture");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT journal_227_protection_fixture");
      }
    }

    const comment = `${prefix} Полный комментарий `.repeat(12).trim();
    const materialResult = await createMaterialInTransaction(actor, { name: `${prefix} Материал`, unitId: unit.id,
      categoryId: category.id, sku: prefix, minStock: 17, comment }, tx);
    assert.ok(materialResult.ok);
    const materialAudit = await tx.changeLog.findFirstOrThrow({ where: { entity: "material", entityId: materialResult.material.id, actorId: actor.id } });
    const materialView = parseJournalPresentation(materialAudit.presentation);
    assert.ok(materialView);
    assert.ok(materialView.changes.some(change => change.path === "comment" && change.after === comment));
    assert.ok(materialView.changes.some(change => change.path === "minStock" && String(change.after) === "17"));

    const warehouseState = await tx.warehouseAccountingState.findUnique({ where: { id: "main" } });
    let stockContext: "verified" | "guard-refused";
    const incomeInput = { kind: "INCOME" as const, clientMutationId: randomUUID(), materialId: materialResult.material.id,
      quantity: "3.250", unitPrice: "7.00", comment };
    if (warehouseState?.phase === "ACTIVE") {
      const income = await warehouseMove(tx, actor, incomeInput);
      const issueInput = { kind: "EXPENSE" as const, clientMutationId: randomUUID(), materialId: materialResult.material.id,
        productId: product.id, quantity: "1.250", comment };
      const issued = await warehouseMove(tx, actor, issueInput);
      const issuedAudit = await tx.changeLog.findFirstOrThrow({ where: { entity: "stockMovement", entityId: issued.movement.id } });
      const issuedView = parseJournalPresentation(issuedAudit.presentation);
      assert.ok(issuedView);
      assert.deepEqual(issuedView.contexts.map(context => [context.kind, context.id]), [["product", product.id]]);
      assert.equal(issuedView.changes.find(change => change.path === "totalByn")?.after, "8.75");
      assert.equal((await warehouseMove(tx, actor, issueInput)).repeated, true);
      assert.equal(await tx.changeLog.count({ where: { entity: "stockMovement", entityId: issued.movement.id } }), 1);
      const deletionPreview = await previewMovementDeletionInTransaction(tx, actor, income.movement.id);
      const deletionInput = { movementId: income.movement.id, planFingerprint: deletionPreview.planFingerprint, clientMutationId: randomUUID() };
      const deletion = await deleteMovementInTransaction(tx, actor, deletionInput);
      const cascadeAudit = await tx.changeLog.findFirstOrThrow({ where: { entity: "stockMovement", entityId: issued.movement.id, action: "softDelete" } });
      const cascadeView = parseJournalPresentation(cascadeAudit.presentation);
      assert.ok(cascadeView);
      assert.equal(cascadeView.action.label, "Удаление");
      assert.equal(cascadeView.actor.type, "system");
      assert.equal(cascadeView.initiator?.id, actor.id);
      assert.deepEqual(cascadeView.contexts.map(context => [context.kind, context.id]), [["product", product.id]]);
      assert.deepEqual(cascadeAudit.newValue, { deletionId: deletion.id, rootMovementId: income.movement.id });
      assert.equal((await deleteMovementInTransaction(tx, actor, deletionInput)).repeated, true);
      stockContext = "verified";
    } else {
      await assert.rejects(warehouseMove(tx, actor, incomeInput), /Склад временно закрыт/);
      assert.equal(await tx.stockMovement.count({ where: { materialId: materialResult.material.id } }), 0);
      stockContext = "guard-refused";
    }

    await toggleExpenseArticleCore(actor, article.id, tx);
    const articleAudit = await tx.changeLog.findFirstOrThrow({ where: { entity: "expenseArticle", entityId: article.id, actorId: actor.id } });
    assert.equal(parseJournalPresentation(articleAudit.presentation)?.changes.find(change => change.path === "active")?.before, true);

    const request = { clientMutationId: randomUUID(), direction: "INCOME" as const, projectId: project.id, amount: 227.15,
      currency: "BYN", cashAccountId: account.id, comment, paidAt: "2026-11-16", rate: 1 };
    const prepared = { project: { id: project.id, number: project.number, currency: "BYN" }, account: { id: account.id, name: account.name },
      articleId: null, paidAt: new Date("2026-11-16T12:00:00.000Z"), rate: 1, rateDate: null, amount: 227.15, bynAmount: 227.15 };
    const saved = await createPaymentInTransaction(actor, request, prepared, tx);
    assert.equal(saved.payment.amount.toFixed(2), "227.15");
    const paymentAudit = await tx.changeLog.findFirstOrThrow({ where: { entity: "payment", entityId: saved.payment.id, action: "create" } });
    const paymentView = parseJournalPresentation(paymentAudit.presentation);
    assert.ok(paymentView);
    assert.deepEqual(paymentView.contexts.map(context => [context.kind, context.id]), [["project", project.id]]);
    assert.equal(paymentView.changes.find(change => change.path === "comment")?.after, comment);
    const receipt = await tx.changeLog.findUniqueOrThrow({ where: { id: paymentReceiptId(request.clientMutationId) } });
    assert.deepEqual(receipt.newValue, { fingerprint: paymentFingerprint(actor.id, request) });
    assert.equal(parseJournalPresentation(receipt.presentation)?.kind, "receipt");
    const auditCount = await tx.changeLog.count({ where: { actorId: actor.id } });
    const repeated = await createPaymentInTransaction(actor, request, prepared, tx);
    assert.equal(repeated.repeated, true);
    assert.equal(repeated.payment.id, saved.payment.id);
    assert.equal(await tx.changeLog.count({ where: { actorId: actor.id } }), auditCount);
    assert.deepEqual((await tx.changeLog.findUniqueOrThrow({ where: { id: receipt.id } })).newValue, receipt.newValue);

    const manifest = { clientMutationId: randomUUID(), date: "2026-11-16", comment,
      shares: [{ projectId: project.id, percentBps: 10000 }],
      lines: [{ projectId: project.id, kind: "MATERIAL" as const, materialId: materialResult.material.id, quantity: 2.125 }] };
    const trip = await createLogisticsTripCore(actor.id, manifest, operation => operation(tx));
    const correctedComment = `${comment} Исправлено полностью`;
    await updateLogisticsTripCore(actor.id, { ...manifest, clientMutationId: randomUUID(), tripId: trip.tripId,
      expectedRevision: trip.revision, comment: correctedComment }, operation => operation(tx));
    const tripAudit = await tx.changeLog.findFirstOrThrow({ where: { entity: "logisticsTrip", entityId: trip.tripId, action: "update" } });
    const tripView = parseJournalPresentation(tripAudit.presentation);
    assert.ok(tripView);
    assert.deepEqual(tripView.contexts.map(context => [context.kind, context.id]), [["project", project.id]]);
    assert.equal(tripView.changes.find(change => change.path === "comment")?.before, comment);
    assert.equal(tripView.changes.find(change => change.path === "comment")?.after, correctedComment);
    // Отложенные ограничения должны пройти до обязательного отката собственных строк.
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    return { ok: true, prefix, stockContext, checks: ["legacy-protection-immutable-guards", "material-full-snapshot", "article-active", "payment-full-snapshot", "payment-raw-receipt-replay", "logistics-context-and-diff", "deferred-constraints"],
      ownedIds: { actor: actor.id, project: project.id, product: product.id, material: materialResult.material.id, payment: saved.payment.id, trip: trip.tripId } };
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT journal_227_probe");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT journal_227_probe");
  }
}
