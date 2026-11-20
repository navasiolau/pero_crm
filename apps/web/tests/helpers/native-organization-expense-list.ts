import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
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
  query.set("comment", prefix + "-empty");
  const empty = await load();
  assert.deepEqual([empty.total, empty.totalByn, empty.rows.length], [0, "0.00", 0]);
  return { checkedRows: 101, lastRow: true, filteredByn: all.totalByn, empty: true, currencies: 2, articles: 2 };
}
