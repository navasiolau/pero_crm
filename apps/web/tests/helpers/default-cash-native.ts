import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { readDefaultCashAccount, saveDefaultCashAccount, toggleCashAccountCore } from "../../src/server/finance/default-cash-core";
import { DEFAULT_CASH_ACCOUNT_KEY } from "../../src/server/finance/default-cash-contracts";

/** Вызывать только внутри guarded rollback-транзакции с двумя собственными активными QA-кассами. */
export async function verifyDefaultCashAccountNative(tx: Prisma.TransactionClient, actor: DomainActor, accountId: string, otherAccountId: string) {
  const initial = await readDefaultCashAccount(tx);
  const saved = await saveDefaultCashAccount(actor, { accountId, expectedRevision: initial.revision }, tx);
  assert.ok(saved.ok); if (!saved.ok) return;
  assert.equal(saved.snapshot.accountId, accountId);
  const audit = await tx.changeLog.findFirstOrThrow({ where: { entity: "orgSetting", entityId: DEFAULT_CASH_ACCOUNT_KEY,
    action: "default-cash.update", actorId: actor.id }, orderBy: { createdAt: "desc" } });
  assert.equal((audit.newValue as { accountId: string }).accountId, accountId);
  const forbidden = await saveDefaultCashAccount({ ...actor, roles: ["ACCOUNTANT"] }, { accountId: otherAccountId, expectedRevision: saved.snapshot.revision }, tx);
  assert.ok(!forbidden.ok && forbidden.kind === "forbidden");
  const conflict = await saveDefaultCashAccount(actor, { accountId: otherAccountId, expectedRevision: initial.revision }, tx);
  assert.ok(!conflict.ok && conflict.kind === "conflict");
  assert.equal((await toggleCashAccountCore(actor, accountId, tx)).ok, true);
  assert.equal((await tx.cashAccount.findUniqueOrThrow({ where: { id: accountId } })).active, false);
  assert.deepEqual(await readDefaultCashAccount(tx), { revision: saved.snapshot.revision + 1, accountId: null });
  assert.equal((await toggleCashAccountCore(actor, accountId, tx)).ok, true);
  assert.equal((await readDefaultCashAccount(tx)).accountId, null);

  const current = await readDefaultCashAccount(tx);
  await saveDefaultCashAccount(actor, { accountId, expectedRevision: current.revision }, tx);
  const before = await readDefaultCashAccount(tx);
  const auditFailure = new Proxy(tx, { get(target, key) {
    if (key === "changeLog") return new Proxy(target.changeLog, { get(delegate, method) {
      if (method === "create") return () => { throw Error("QA175_AUDIT_FAILURE"); };
      return Reflect.get(delegate, method);
    } });
    return Reflect.get(target, key);
  } });
  await tx.$executeRawUnsafe("SAVEPOINT qa175_audit");
  try { await assert.rejects(toggleCashAccountCore(actor, accountId, auditFailure), /QA175_AUDIT_FAILURE/); }
  finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa175_audit"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa175_audit"); }
  assert.deepEqual(await readDefaultCashAccount(tx), before);
  assert.equal((await tx.cashAccount.findUniqueOrThrow({ where: { id: accountId } })).active, true);
  return { settingAudit: true, roleBoundary: true, staleRevision: true, atomicDeactivate: true, realSqlRollback: true };
}
