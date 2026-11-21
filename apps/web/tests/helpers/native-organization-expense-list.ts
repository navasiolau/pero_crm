import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { encodeListFilterValue } from "../../src/lib/list-filter-values";
import { loadOrganizationExpensePage } from "../../src/server/finance/organization-ledger";

/** Внешняя транзакция приёмки отменяет все тестовые строки после запроса реестра. */
export async function verifyOrganizationExpenseList(tx: Prisma.TransactionClient) {
  const prefix = "qa-expenses-" + randomUUID();
  const user = await tx.user.create({ data: { email: prefix + "@example.invalid", name: "Проверка реестра", roles: ["ACCOUNTANT"], passwordHash: "disabled" } });
  const max = (await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0;
  const articles = await Promise.all([1, 2].map(index => tx.expenseArticle.create({ data: { code: max + index, name: prefix + index } })));
  const rows = Array.from({ length: 101 }, (_, index) => {
    const usd = index % 2;
    return { id: prefix + "-" + String(index).padStart(3, "0"), direction: "EXPENSE" as const, amount: 1, currency: usd ? "USD" : "BYN",
      rate: usd ? 3 : 1, bynAmount: usd ? 3 : 1, expenseArticleId: articles[usd].id, comment: prefix, createdById: user.id };
  });
  await tx.payment.createMany({ data: rows });
  const scope = { $transaction: (read: (inner: Prisma.TransactionClient) => Promise<unknown>) => read(tx) } as Pick<PrismaClient, "$transaction">;
  const query = new URLSearchParams({ comment: prefix, article: encodeListFilterValue(articles.map(article => article.id))!,
    sort: "id", dir: "asc", pageSize: "all", page: "2" });
  const load = () => loadOrganizationExpensePage(user, query.toString(), scope);
  const all = await load();
  assert.equal(all.page, 1); assert.equal(all.total, 101); assert.equal(all.totalByn, "201.00");
  assert.deepEqual(all.rows.map(row => row.id), rows.map(row => row.id));
  query.set("pageSize", "100");
  const second = await load();
  assert.equal(second.total, all.total); assert.equal(second.totalByn, all.totalByn);
  assert.deepEqual(second.rows.map(row => row.id), [rows[100].id]);
  query.set("q", "USD");
  const foreign = await load();
  assert.deepEqual([foreign.total, foreign.totalByn, foreign.rows.length], [50, "150.00", 50]);
  query.delete("q");
  query.set("comment", prefix + "-empty");
  const empty = await load();
  assert.deepEqual([empty.total, empty.totalByn, empty.rows.length], [0, "0.00", 0]);
  const searchChecks = await verifySearch(tx, scope, user, prefix + "-поиск", max + 3);
  return { checkedRows: 101, lastRow: true, filteredByn: all.totalByn, empty: true, currencies: 2, articles: 2, searchChecks };
}

async function verifySearch(tx: Prisma.TransactionClient, scope: Pick<PrismaClient, "$transaction">,
  actor: Parameters<typeof loadOrganizationExpensePage>[0], prefix: string, articleCode: number) {
  const createdById = actor.id;
  const base = { direction: "EXPENSE", comment: prefix, createdById, paidAt: new Date("2026-11-20T21:00:00.000Z") } as const;
  const [cash, article, client, unit, secondUnit] = await Promise.all([
    tx.cashAccount.create({ data: { name: prefix + " Валютная касса", currency: "USD" } }),
    tx.expenseArticle.create({ data: { name: prefix + " Снабжение", code: articleCode } }),
    tx.client.create({ data: { name: prefix, phone: prefix } }),
    tx.materialUnit.create({ data: { name: prefix + " м²" } }),
    tx.materialUnit.create({ data: { name: prefix + " пог. м" } }),
  ]);
  const numberInt = 1_400_000_000 + Number.parseInt(randomUUID().slice(0, 7), 16);
  const project = await tx.project.create({ data: { clientId: client.id, numberInt, number: String(numberInt), title: prefix + " Проект" } });
  const makeDocument = (name: string, state: "READY" | "RETAINED" = "READY") => tx.financeDocument.create({ data: {
    uploadedById: createdById, clientMutationId: randomUUID(), requestFingerprint: prefix, state,
    readyAt: base.paidAt, fileName: name, mimeType: "application/pdf", size: 1, contentHash: prefix,
    storageKey: "qa239/" + randomUUID(), storageMode: "local",
  } });
  const [firstDocument, secondDocument, deletedDocument, retainedDocument] = await Promise.all([
    makeDocument("Отчёт первичный.pdf"), makeDocument("Чек_№2.pdf"),
    makeDocument("Скрытый удалённый чек.pdf"), makeDocument("Отозванный документ.pdf", "RETAINED"),
  ]);
  const foreign = await tx.payment.create({ data: { ...base, currency: "USD", amount: "1000.00", bynAmount: "3214.57",
    rate: "3.214567", rateDate: new Date("2026-11-19T20:59:59.999Z"), paidAt: new Date("2026-11-19T21:00:00.000Z"),
    cashAccountId: cash.id, expenseArticleId: article.id, projectId: project.id, projectAmount: "3214.57",
    reportDocumentId: firstDocument.id, comment: prefix + " Видимый комментарий",
  } });
  await tx.paymentReportDocument.create({ data: { paymentId: foreign.id, documentId: secondDocument.id, position: 1 } });
  await tx.payment.create({ data: { ...base, amount: "1000.00", bynAmount: "1000.00",
    deletedAt: base.paidAt, deletedById: createdById, reportDocumentId: deletedDocument.id,
  } });
  const [domestic, legacy, modern] = await Promise.all([
    tx.payment.create({ data: { ...base, amount: "1000.00", bynAmount: "1000.00", paidAt: new Date("2026-11-22T21:00:00Z") } }),
    tx.payment.create({ data: { ...base, amount: "20.63", bynAmount: "20.63" } }),
    tx.payment.create({ data: { ...base, currency: "USD", amount: "20.00", rate: "3.25", bynAmount: "65.00" } }),
  ]);
  const movement = async (name: string, quantity: string, totalByn: string, unitId: string) => {
    const material = await tx.material.create({ data: { name: prefix + " " + name, unitId } });
    return tx.stockMovement.create({ data: { materialId: material.id, type: "INCOME", quantity, totalByn, createdById } });
  };
  const [legacyMove, first, second, cancelledMove] = await Promise.all([
    movement("Ламинат", "2.5", "20.63", unit.id),
    movement("Фанера", "6.577", "23.82", unit.id),
    movement("Кромка", "18", "41.18", secondUnit.id),
    movement("Снятая закупка", "7.777", "15.01", unit.id),
  ]);
  const receiptRequest = () => ({ clientMutationId: randomUUID(), requestFingerprint: prefix, actorId: createdById, paymentId: modern.id });
  await Promise.all([
    tx.stockPurchase.create({ data: { ...receiptRequest(), paymentId: legacy.id, unitPrice: "8.25", movementId: legacyMove.id } }),
    tx.expenseReceipt.create({ data: { ...receiptRequest(), lines: { create: [
      { position: 0, movementId: first.id, amount: "7.33", unitPrice: "1.234567890123" },
      { position: 1, movementId: second.id, amount: "12.67", unitPrice: "0.000000000001" },
    ] } } }),
    tx.expenseReceipt.create({ data: { ...receiptRequest(), cancelledAt: base.paidAt, lines: { create: [
      { position: 0, movementId: cancelledMove.id, amount: "19.97", unitPrice: "9.876543210987" },
    ] } } }),
  ]);
  const tripProject = await tx.project.create({ data: { clientId: client.id, numberInt: numberInt + 1,
    number: String(numberInt + 1), title: prefix + " Второй проект" } });
  const tripCash = await tx.cashAccount.create({ data: { name: prefix + " Касса логистики", currency: "BYN" } });
  const hiddenArticle = await tx.expenseArticle.create({ data: { name: prefix + " Старая статья рейса", code: articleCode + 1 } });
  const logistics = await makeLogisticsPayments(tx, {
    actorId: createdById, comment: prefix, project: tripProject, cash: tripCash, expenseArticleId: hiddenArticle.id,
    materialId: legacyMove.materialId, materialName: prefix + " Ламинат", materialUnit: unit.name,
  });
  const checks = [
    ["20.11.2026", [foreign]], ["2026-11-19", [foreign]], ["2026-11-21", [legacy, modern]],
    ["30.02.2026", []], ["3,214567", [foreign]], ["3,214567 USD", []], ["3.214567 / 19.11.2026", [foreign]],
    ["1 000,00 USD", [foreign]], ["1\u00a0000,00\u00a0$", [foreign]],
    ["1 000,00 BYN", [domestic]], ["1\u00a0000,00 BYN", [domestic]], ["1\u202f000,00 BYN", [domestic]],
    ["3 214,57 BYN", [foreign]], ["3 214,57 USD", []], ["1 000,00 RUB", []], ["$", [foreign, modern]],
    [foreign.id, [foreign]], [project.number, [foreign]], [project.title, [foreign]], [project.number + " · " + project.title, [foreign]],
    ["Валютная касса", [foreign]], ["Снабжение", [foreign]], ["чек_№2.pdf", [foreign]], ["чек%№2.pdf", []],
    [deletedDocument.fileName, []], [retainedDocument.fileName, []],
    ["общий расход организации", [domestic]], ["видимый комментарий", [foreign]],
    ["приход на склад", [legacy, modern]], ["Ламинат", [legacy]], [legacyMove.id, [legacy]], ["8,25 BYN", [legacy]],
    ["2,5 " + unit.name, [legacy]], ["пог. м", [modern]], ["6,577", [modern]], ["6,577 " + secondUnit.name, []],
    ["Фанера", [modern]], [first.id, [modern]], ["7,33 USD", [modern]], ["7,33 BYN", []],
    ["23,82 BYN", [modern]], ["23,82 USD", []], ["1,234567890123 USD", [modern]], ["1,234567890124 USD", []],
    ["1,234567890123 BYN", []], ["1e-12 USD", [modern]], ["Снятая закупка", []], [cancelledMove.id, []],
    ["9,876543210987", []],
    ["Логистика", [logistics.current]], ["Расход по рейсу", [logistics.current]],
    ["Действующая ТТН.pdf", [logistics.current]], ["Старая ТТН.pdf", []],
    [logistics.previous.id, []], [hiddenArticle.name, []],
  ] as const;
  async function assertSearch(q: string, expected: readonly { id: string; bynAmount: Prisma.Decimal }[], filters: Record<string, string> = {}) {
    const params = new URLSearchParams({ comment: prefix, pageSize: "all", q, ...filters });
    const result = await loadOrganizationExpensePage(actor, params.toString(), scope);
    assert.deepEqual(result.rows.map(row => row.id).sort(), expected.map(row => row.id).sort(), q);
    const sum = expected.reduce((total, row) => total.plus(row.bynAmount), new Prisma.Decimal(0));
    assert.deepEqual([result.total, result.totalByn], [expected.length, sum.toFixed(2)], q);
  }
  for (const [q, expected] of checks) await assertSearch(q, expected);
  await assertSearch("1,234567890123", [modern], { stockUnitPriceFrom: "1.234567890123", stockUnitPriceTo: "1.234567890123" });
  await assertSearch("Фанера", [], { material: first.materialId, stockUnit: secondUnit.id });
  return checks.length + 2;
}

async function makeLogisticsPayments(tx: Prisma.TransactionClient, input: {
  actorId: string; comment: string; project: { id: string; number: string }; cash: { id: string; name: string }; expenseArticleId: string;
  materialId: string; materialName: string; materialUnit: string;
}) {
  const { actorId, comment, project, cash, expenseArticleId, materialId, materialName, materialUnit } = input;
  const date = "2026-11-22", paidAt = new Date(date);
  const trip = await tx.logisticsTrip.create({ data: { date: paidAt, comment, revision: 2, createdById: actorId, updatedById: actorId } });
  const share = { projectId: project.id, percentBps: 10000 };
  await tx.logisticsProjectShare.create({ data: { tripId: trip.id, ...share } });
  const line = { projectId: project.id, kind: "MATERIAL" as const, materialId, productId: null,
    nameSnapshot: materialName, numberSnapshot: null, unitSnapshot: materialUnit, quantity: 1 };
  await tx.logisticsShipmentLine.create({ data: { tripId: trip.id, ...line } });
  const manifestSnapshot = { date, comment, ttnNotRequired: false, shares: [share], lines: [line] };
  const money = { amount: "55.00", bynAmount: "55.00", currency: "BYN", rate: "1", cashAccountId: cash.id, paidAt, expenseArticleId };
  async function posting(tripRevision: number, status: "ACTIVE" | "SUPERSEDED", fileName: string) {
    const document = await tx.logisticsDocument.create({ data: {
      tripId: trip.id, clientMutationId: randomUUID(), requestFingerprint: comment, uploadedById: actorId,
      fileName, mimeType: "application/pdf", size: 1, contentHash: comment, readyAt: paidAt,
      storageKey: "qa239/logistics/" + randomUUID(), storageMode: "local", state: "READY", stage: "SIGNED",
    } });
    const entry = await tx.logisticsPosting.create({ data: {
      ...money, tripId: trip.id, tripRevision, status, clientMutationId: randomUUID(), requestFingerprint: comment,
      actorId, actorNameSnapshot: comment, cashAccountNameSnapshot: cash.name, manifestSnapshot,
    } });
    await tx.logisticsPostingDocument.create({ data: { postingId: entry.id, tripId: trip.id, documentId: document.id } });
    const allocation = await tx.logisticsPostingAllocation.create({ data: { postingId: entry.id, ...share,
      projectNumberSnapshot: project.number, amount: money.amount, bynAmount: money.bynAmount } });
    return tx.payment.create({ data: {
      ...money, projectId: project.id, projectAmount: money.bynAmount, logisticsAllocationId: allocation.id,
      direction: "EXPENSE", comment, createdById: actorId,
    } });
  }
  const previous = await posting(1, "SUPERSEDED", "Старая ТТН.pdf");
  const current = await posting(2, "ACTIVE", "Действующая ТТН.pdf");
  return { previous, current };
}
