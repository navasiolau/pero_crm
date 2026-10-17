import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { createCounterpartyInTransaction, updateCounterpartyInTransaction } from "../../src/server/counterparties/core";
import type { CounterpartyInput, CounterpartyView } from "../../src/server/counterparties/contracts";

function inputFor(item: CounterpartyView): CounterpartyInput {
  return { type: item.type, company: item.company, phone: item.phone ?? undefined, comment: item.comment ?? undefined };
}

/** Только внутри guarded rollback-транзакции; изменяет только собственные созданные здесь записи. */
export async function verifyCounterpartyNative(tx: Prisma.TransactionClient, actor: DomainActor) {
  const created = await createCounterpartyInTransaction(tx, actor, { type: "SUPPLIER", company: "  __QA174_COUNTERPARTY  ", phone: " +375 00 QA174 ", comment: "  Проверка174  " });
  assert.ok(created.ok);
  const item = created.item;
  assert.equal(item.revision, 0); assert.equal(item.company, "__QA174_COUNTERPARTY"); assert.equal(item.phone, "+375 00 QA174");
  const carrier = await createCounterpartyInTransaction(tx, actor, { type: "CARRIER", company: item.company });
  assert.ok(carrier.ok); assert.notEqual(carrier.item.id, item.id); assert.equal(carrier.item.phone, null); assert.equal(carrier.item.comment, null);
  const owned = [item.id, carrier.item.id], auditWhere = { entity: "counterparty", entityId: { in: owned }, actorId: actor.id };
  assert.equal(await tx.changeLog.count({ where: auditWhere }), 2);
  const noop = await updateCounterpartyInTransaction(tx, actor, item.id, inputFor(item), 0);
  assert.ok(noop.ok && noop.noOp); assert.equal(await tx.changeLog.count({ where: auditWhere }), 2);
  const cleared = await updateCounterpartyInTransaction(tx, actor, item.id, { type: "CARRIER", company: item.company, phone: " ", comment: "" }, 0);
  assert.ok(cleared.ok); assert.equal(cleared.item.revision, 1); assert.equal(cleared.item.phone, null); assert.equal(cleared.item.comment, null);
  const stale = await updateCounterpartyInTransaction(tx, actor, item.id, { ...inputFor(item), company: "STALE" }, 0);
  assert.ok(!stale.ok && stale.kind === "conflict");
  assert.equal((await tx.counterparty.findUniqueOrThrow({ where: { id: item.id } })).company, item.company);
  const ownLogs = await tx.changeLog.findMany({ where: auditWhere, orderBy: { createdAt: "asc" } });
  assert.equal(ownLogs.length, 3); assert.ok(ownLogs.some(row => row.action === "update" && (row.newValue as { phone: unknown }).phone === null));
  for (const roles of [["ENGINEER"], ["ACCOUNTANT"]] as DomainActor["roles"][]) {
    assert.equal((await createCounterpartyInTransaction(tx, { ...actor, roles }, { type: "SUPPLIER", company: "FORBIDDEN" })).ok, false);
    assert.equal((await updateCounterpartyInTransaction(tx, { ...actor, roles }, item.id, inputFor(item), 1)).ok, false);
  }
  const original = await tx.counterparty.findUniqueOrThrow({ where: { id: item.id } });
  const failAudit = new Proxy(tx, { get(target, key) {
    if (key === "changeLog") return new Proxy(target.changeLog, { get(delegate, method) {
      if (method === "create") return () => { throw Error("QA174_AUDIT_FAILURE"); };
      return Reflect.get(delegate, method);
    } });
    return Reflect.get(target, key);
  } });
  await tx.$executeRawUnsafe("SAVEPOINT qa174_audit");
  try { await assert.rejects(updateCounterpartyInTransaction(failAudit, actor, item.id, { type: "SUPPLIER", company: "MUST_ROLLBACK" }, 1), /QA174_AUDIT_FAILURE/); }
  finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa174_audit"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa174_audit"); }
  assert.deepEqual(await tx.counterparty.findUniqueOrThrow({ where: { id: item.id } }), original);
  assert.equal(await tx.changeLog.count({ where: auditWhere }), 3);
  return { createBothTypes: true, optionalContacts: true, roleBoundary: true, revisionCas: true, noOpAudit: true, realSqlRollback: true, ownedCounterpartyIds: owned };
}
