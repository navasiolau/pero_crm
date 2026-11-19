import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeListQuery, resolveListState, encodeListPreference, updateListQuery } from "../src/lib/list-state";
import { loadOrganizationExpensePage } from "../src/server/finance/organization-ledger";
import { expenseBaseWhere, organizationExpenseQuery } from "../src/server/finance/organization-expense-query";

test("расходы сохраняют режим «Все» и канонизируют переход на первую страницу", () => {
  const section = "organizationExpenses";
  const all = normalizeListQuery(section, "pageSize=all&page=5&cash=%5B%22b%22%2C%22a%22%5D");
  const saved = encodeListPreference(section, all, "rev");
  assert.equal(resolveListState(section, {}, saved), all);
  assert.equal(resolveListState(section, { pageSize: "100" }, saved), "view=table&pageSize=100");
  assert.equal(new URLSearchParams(updateListQuery(section, all, { pageSize: "100" })).has("page"), false);
  assert.equal(normalizeListQuery("projects", "pageSize=all"), "view=kanban");
  assert.equal(normalizeListQuery(section, "dateFrom=2026-02-30&amountFrom=5%2C50"), "view=table&amountFrom=5.50");
});

test("условия отдельных полей соединяются через И, значения поля через ИЛИ", () => {
  const params = new URLSearchParams({
    cash: '["a","b"]', article: '["@logistics","other"]', purpose: '["@general","@stock","p1"]',
    dateFrom: "2026-11-20", dateTo: "2026-11-20", document: "Рейс_10",
    bynFrom: "0.01", material: '["m1","m2"]', stockUnit: "unit",
    stockQtyFrom: "2.5", stockUnitPriceTo: "17", stockValueBynFrom: "30", movement: "movement-id",
  });
  const { where, orderBy } = organizationExpenseQuery(params.toString());
  const [base, scalar, ...selectors] = where.AND;
  assert.deepEqual(base, expenseBaseWhere);
  assert.deepEqual(scalar.paidAt, { gte: new Date("2026-11-19T21:00:00Z"), lt: new Date("2026-11-20T21:00:00Z") });
  assert.deepEqual(scalar.bynAmount, { gte: "0.01", lte: undefined });
  assert.deepEqual(selectors[0], { OR: [
    { projectId: null, stockPurchase: { is: null } },
    { projectId: null, stockPurchase: { isNot: null } },
    { projectId: "p1" },
  ] });
  assert.deepEqual(selectors[1], { OR: [
    { logisticsAllocationId: { not: null } },
    { logisticsAllocationId: null, expenseArticleId: "other" },
  ] });
  assert.deepEqual(selectors[2], { OR: [{ cashAccountId: "a" }, { cashAccountId: "b" }] });
  assert.equal(selectors[3].OR?.length, 3);
  assert.match(JSON.stringify(selectors[3]), /READY/);
  assert.deepEqual(selectors[4], { stockPurchase: {
    movementId: { contains: "movement-id", mode: "insensitive" }, unitPrice: { gte: undefined, lte: "17" },
    movement: { materialId: { in: ["m1", "m2"] }, material: { unitId: { in: ["unit"] } },
      quantity: { gte: "2.5", lte: undefined }, totalByn: { gte: "30", lte: undefined } },
  } });
  assert.deepEqual(orderBy, [{ paidAt: "desc" }, { id: "desc" }]);
});

test("итог и количество независимы от размера, авторизация предшествует чтению", async () => {
  let count = 101;
  const calls: Array<{ name: string; input: unknown }> = [];
  const reads = {
    payment: {
      async aggregate(input: unknown) {
        calls.push({ name: "aggregate", input });
        return { _count: count, _sum: { bynAmount: count ? new Prisma.Decimal("123456789012345678.09") : null } };
      },
      async findMany(input: unknown) { calls.push({ name: "rows", input }); return []; },
      async groupBy() { return []; },
    },
    project: { async findMany() { return []; } },
    cashAccount: { async findMany() { return []; } },
    expenseArticle: { async findMany() { return []; } },
    material: { async findMany() { return []; } },
    orgSetting: { async findUnique() { return null; } },
  };
  const db = { async $transaction(fn: (tx: typeof reads) => unknown, options: unknown) {
    assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
    return fn(reads);
  } } as unknown as Pick<PrismaClient, "$transaction">;
  const actor = { id: "finance", roles: ["ADMIN"] as ["ADMIN"] };

  await assert.rejects(() => loadOrganizationExpensePage({ ...actor, roles: ["MANAGER"] }, "", db), /Недостаточно прав/);
  assert.equal(calls.length, 0);
  const page = await loadOrganizationExpensePage(actor, "pageSize=100&page=500&currency=BYN", db);
  assert.equal(page.page, 2);
  assert.equal(page.total, 101);
  assert.equal(page.totalByn, "123456789012345678.09");
  const all = await loadOrganizationExpensePage(actor, "pageSize=all&page=500&currency=BYN", db);
  assert.equal(all.page, 1);
  assert.equal(all.totalByn, page.totalByn);
  const [[pageWhere, pageRows], [allWhere, allRows]] = [0, 2].map(index => calls.slice(index, index + 2).map(call => call.input as { where: unknown; skip?: number; take?: number }));
  assert.deepEqual(pageWhere.where, pageRows.where);
  assert.deepEqual(allWhere.where, allRows.where);
  assert.equal(pageRows.skip, 100);
  assert.equal(pageRows.take, 100);
  assert.equal(allRows.take, undefined);
  assert.equal(allRows.skip, undefined);
  count = 0;
  const empty = await loadOrganizationExpensePage(actor, "page=500", db);
  assert.equal(empty.page, 1);
  assert.equal(empty.totalByn, "0.00");
});
