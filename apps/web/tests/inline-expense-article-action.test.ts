import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { FINANCE_ROLES, hasAnyRole } from "../src/lib/roles";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

test("article action returns canonical option, preserves ACL/code/audit, and never conducts money", async () => {
  const actor = { id: "actor178", name: "Снабженец", roles: ["PROCUREMENT"] as Role[] };
  let failAudit = false, transactions = 0;
  const articles: { id: string; code: number; name: string; comment: string | null; active: boolean }[] = [];
  const audits: unknown[] = [], revalidations: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    expenseArticle: {
      aggregate: async () => ({ _max: { code: articles.length ? Math.max(...articles.map(article => article.code)) : null } }),
      findUnique: async ({ where }: { where: { code: number } }) => articles.find(article => article.code === where.code) ?? null,
      create: async ({ data }: { data: Prisma.ExpenseArticleCreateInput }) => {
        const article = { id: `article-${articles.length + 1}`, code: data.code!, name: data.name, comment: data.comment ?? null, active: true };
        articles.push(article); return article;
      },
    },
    changeLog: { create: async ({ data }: { data: unknown }) => { if (failAudit) throw Error("AUDIT_FAILURE"); audits.push(data); return data; } },
  };
  const database = { ...tx, $transaction: async <T>(operation: (db: typeof tx) => Promise<T>) => {
    transactions++; const before = { articles: articles.length, audits: audits.length };
    try { return await operation(tx); } catch (error) { articles.length = before.articles; audits.length = before.audits; throw error; }
  } };
  const scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/finance/actions"], prisma: database,
    allowedOverrides: ["../src/server/require-role", "next/cache"], overrides: {
      "../src/server/require-role": { requireFinance: async () => { if (!hasAnyRole(actor.roles, FINANCE_ROLES)) throw Error("Недостаточно прав"); return { user: actor }; } },
      "next/cache": { revalidatePath: (path: string) => revalidations.push(path) },
    } });
  try {
    const actions = scope.load<typeof import("../src/server/finance/actions")>("../src/server/finance/actions");
    const saved = await actions.addExpenseArticle({ name: "  Новая статья  ", comment: "  Примечание  " });
    assert.deepEqual(saved, { ok: true, article: { id: "article-1", name: "Новая статья" } });
    assert.equal(articles[0].code, 1); assert.equal(articles[0].comment, "Примечание"); assert.equal(audits.length, 1);
    assert.deepEqual(revalidations, ["/finance/articles"]);
    assert.equal((await actions.addExpenseArticle({ name: "С кодом", code: "73" })).ok, true);
    assert.equal(articles[1].code, 73);
    assert.equal((await actions.addExpenseArticle({ name: "Дубль", code: "73" })).ok, false);
    assert.equal((await actions.addExpenseArticle({ name: " ", code: "74" })).ok, false);
    for (const roles of [["MANAGER"], ["ENGINEER"], ["WORKER"], []] as Role[][]) {
      actor.roles = roles; const before = transactions;
      await assert.rejects(actions.addExpenseArticle({ name: "Запрещено" }), /прав/); assert.equal(transactions, before);
    }
    actor.roles = ["MANAGER", "ACCOUNTANT"];
    assert.equal((await actions.addExpenseArticle({ name: "Совмещённая роль" })).ok, true);
    failAudit = true;
    assert.equal((await actions.addExpenseArticle({ name: "Откат" })).ok, false);
    assert.equal(articles.length, 3); assert.equal(audits.length, 3);
    // Любой обращённый денежный delegate отсутствует и остановлен guardedModuleCache.
  } finally { scope.restore(); }
});
