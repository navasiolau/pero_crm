import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { createExpenseArticleCore } from "../../src/server/finance/article-core";

/** Только внутри guarded rollback-транзакции оркестратора; создавать вне неё не разрешает. */
export async function verifyInlineExpenseArticleNative(tx: Prisma.TransactionClient, actor: DomainActor) {
  const before = await Promise.all([tx.payment.count(), tx.payout.count(), tx.stockMovement.count(), tx.expenseArticle.count(), tx.changeLog.count()]);
  const maximum = (await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0;
  const created = await createExpenseArticleCore(actor, { name: "  QA178 новая статья  ", comment: "  Примечание  " }, tx);
  assert.ok(created.ok); if (!created.ok) return;
  assert.equal(created.article.name, "QA178 новая статья"); assert.equal(created.article.comment, "Примечание"); assert.equal(created.article.code, maximum + 1);
  const audit = await tx.changeLog.findFirstOrThrow({ where: { entity: "expenseArticle", entityId: created.article.id, action: "create", actorId: actor.id } });
  assert.equal((audit.newValue as { code: number }).code, maximum + 1);
  assert.equal((await createExpenseArticleCore(actor, { name: "QA178 конфликт", code: String(created.article.code) }, tx)).ok, false);
  for (const roles of [["ENGINEER"], ["MANAGER"], ["WORKER"]] as DomainActor["roles"][]) {
    assert.equal((await createExpenseArticleCore({ ...actor, roles }, { name: "QA178 запрет" }, tx)).ok, false);
  }
  const brokenAudit = new Proxy(tx, { get(target, key) {
    if (key === "changeLog") return new Proxy(target.changeLog, { get(delegate, method) {
      if (method === "create") return () => { throw Error("QA178_AUDIT_FAILURE"); };
      return Reflect.get(delegate, method);
    } });
    return Reflect.get(target, key);
  } });
  await tx.$executeRawUnsafe("SAVEPOINT qa178_audit");
  try { await assert.rejects(createExpenseArticleCore(actor, { name: "QA178 откат" }, brokenAudit), /QA178_AUDIT_FAILURE/); }
  finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa178_audit"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa178_audit"); }
  assert.deepEqual(await Promise.all([tx.payment.count(), tx.payout.count(), tx.stockMovement.count()]), before.slice(0, 3));
  assert.equal(await tx.expenseArticle.count(), before[3] + 1); assert.equal(await tx.changeLog.count(), before[4] + 1);
  return { canonicalArticle: true, automaticCode: true, roleAndUniqueGuards: true, auditRollback: true, noFinancialOrStockWrites: true };
}
