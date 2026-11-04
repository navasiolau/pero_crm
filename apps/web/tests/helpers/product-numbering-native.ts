import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, Product } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import type * as Products from "../../src/server/products/core";
import { applyProductNumberRepairInTransaction, checkProductNumberRepairInTransaction, rollbackProductNumberRepairInTransaction } from "../../src/server/products/number-repair";

/** Вызывается только внутри существующей guarded rollback-транзакции local/staging/CI. */
export async function verifyProductNumberingNative(tx: Prisma.TransactionClient, actor: DomainActor,
  core: Pick<typeof Products, "createProductCore" | "deleteProductCore">) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  const client = await tx.client.create({ data: { name: "Синтетический клиент211", phone: "QA211_SYNTHETIC" } });
  let next = (await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt ?? 0;
  const project = () => { const number = String(++next); return tx.project.create({ data: { number, numberInt: next, title: "Проверка211", clientId: client.id, stage: "CONTRACT" } }); };
  const transaction = <T>(run: (db: Prisma.TransactionClient) => Promise<T>) => run(tx);
  const c = await project();
  const originals: Product[] = [];
  for (let suffix = 1; suffix <= 15; suffix++) originals.push(await tx.product.create({ data: {
    projectId: c.id, number: `${c.number}.${suffix}`, suffixInt: suffix, title: `Проверка211 ${suffix}`, quantity: 5,
    status: suffix === 5 ? "DRAFT" : suffix === 8 ? "DONE" : "PREPARATION", expectedPrice: "123.45", engineerId: actor.id,
  } }));
  const removed = await tx.product.create({ data: { projectId: c.id, number: `${c.number}.63`, suffixInt: 63, title: "Скрытое211", deletedAt: new Date(0) } });
  const reused = await tx.product.create({ data: { projectId: c.id, number: `${c.number}.15`, suffixInt: 15, title: "Скрытый повтор211", deletedAt: new Date(0) } });
  const task = await tx.task.create({ data: { projectId: c.id, productId: originals[7].id, title: "Сохранённая задача211", status: "DONE", quantity: "1", assigneeId: actor.id } });
  const earning = await tx.payrollEntry.create({ data: { userId: actor.id, productId: originals[7].id, taskId: task.id, amount: "100", bynAmount: "100", month: "2020-01" } });
  const links = [];
  for (const row of [originals[6], originals[7], originals[14]]) links.push(await tx.notification.create({ data: {
    userId: actor.id, type: "qa211", title: "Проверка211", link: `/products/${row.number}?from=211#tasks`,
  } }));
  const deletion = { expectedUpdatedAt: originals[6].updatedAt.toISOString(), clientMutationId: randomUUID() };
  const deleted = await core.deleteProductCore(actor, originals[6].id, transaction, deletion); assert.ok(deleted.ok, JSON.stringify(deleted));
  const rows = await tx.product.findMany({ where: { projectId: c.id, deletedAt: null }, orderBy: { suffixInt: "asc" } });
  assert.deepEqual(rows.map(row => row.number), Array.from({ length: 14 }, (_, i) => `${c.number}.${i + 1}`));
  for (const row of rows) {
    const prior: Product = originals.find(item => item.id === row.id)!;
    const business = ({ number, suffixInt, updatedAt, ...value }: Product) => { void number; void suffixInt; void updatedAt; return value; };
    assert.deepEqual(business(row), business(prior));
    if (prior.suffixInt! < 7) assert.deepEqual(row, prior);
  }
  for (const [index, original] of [originals[6], originals[7], originals[14]].entries()) assert.equal(
    (await tx.notification.findUniqueOrThrow({ where: { id: links[index].id } })).link, `/products/${original.id}?from=211#tasks`);
  assert.deepEqual(await tx.task.findUniqueOrThrow({ where: { id: task.id } }), task);
  assert.deepEqual(await tx.payrollEntry.findUniqueOrThrow({ where: { id: earning.id } }), earning);
  assert.deepEqual(await tx.product.findUniqueOrThrow({ where: { id: removed.id } }), removed);
  assert.deepEqual(await tx.product.findUniqueOrThrow({ where: { id: reused.id } }), reused);
  const auditCount = await tx.changeLog.count({ where: { entity: "product", entityId: { in: originals.map(row => row.id) } } });
  const repeat = await core.deleteProductCore(actor, originals[6].id, transaction, deletion); assert.ok(repeat.ok && repeat.repeated);
  assert.equal(await tx.changeLog.count({ where: { entity: "product", entityId: { in: originals.map(row => row.id) } } }), auditCount);
  const added = await core.createProductCore(actor, { projectId: c.id, title: "После удаления211" }, transaction);
  assert.ok(added.ok); assert.equal(added.product.number, `${c.number}.15`);
  for (const target of [originals[0].id, added.product.id]) {
    const row = await tx.product.findUniqueOrThrow({ where: { id: target } });
    assert.ok((await core.deleteProductCore(actor, target, transaction, { expectedUpdatedAt: row.updatedAt.toISOString(), clientMutationId: randomUUID() })).ok);
  }
  for (const row of await tx.product.findMany({ where: { projectId: c.id, deletedAt: null } })) {
    const current = await tx.product.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok((await core.deleteProductCore(actor, row.id, transaction, { expectedUpdatedAt: current.updatedAt.toISOString(), clientMutationId: randomUUID() })).ok);
  }
  const first = await core.createProductCore(actor, { projectId: c.id, title: "Первое заново211", quantity: 99 }, transaction);
  assert.ok(first.ok); assert.equal(first.product.number, `${c.number}.1`);

  const repair = await project();
  const expectedSuffixes = [2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 61, 62, 63, 64];
  for (const suffix of expectedSuffixes) await tx.product.create({ data: {
    projectId: repair.id, number: `${repair.number}.${suffix}`, suffixInt: suffix, title: "Коррекция211", status: "PREPARATION",
  } });
  await assert.rejects(checkProductNumberRepairInTransaction(tx, { projectNumber: repair.number, operationId: randomUUID() }), /COMPOSITION/);
  const baseline = await checkProductNumberRepairInTransaction(tx, { projectNumber: repair.number, operationId: randomUUID(), expectedSuffixes });
  const applied = await applyProductNumberRepairInTransaction(tx, baseline); assert.equal(applied.to, `${repair.number}.15`);
  assert.equal((await applyProductNumberRepairInTransaction(tx, baseline)).repeated, true);
  const unchanged = await tx.product.findMany({ where: { projectId: repair.id }, orderBy: { id: "asc" } });
  await assert.rejects(rollbackProductNumberRepairInTransaction(tx, { ...baseline, protectedHash: "0".repeat(64) }), /RECEIPT_PAYLOAD/);
  await tx.product.update({ where: { id: baseline.productId }, data: { title: "Изменено после правки211" } });
  await assert.rejects(rollbackProductNumberRepairInTransaction(tx, baseline), /POST_STATE_CHANGED/);
  await tx.product.update({ where: { id: baseline.productId }, data: { title: "Коррекция211", updatedAt: new Date(applied.updatedAt) } });
  assert.deepEqual(await tx.product.findMany({ where: { projectId: repair.id }, orderBy: { id: "asc" } }), unchanged);
  const rollback = await rollbackProductNumberRepairInTransaction(tx, baseline); assert.equal(rollback.to, `${repair.number}.64`);
  assert.equal((await rollbackProductNumberRepairInTransaction(tx, baseline)).repeated, true);
  const fresh = await checkProductNumberRepairInTransaction(tx, { projectNumber: repair.number, operationId: randomUUID(), expectedSuffixes });
  await tx.product.update({ where: { id: fresh.productId }, data: { description: "Устаревший baseline211" } });
  await assert.rejects(applyProductNumberRepairInTransaction(tx, fresh), /STALE_BASELINE/);
  const occupied = await tx.product.create({ data: { projectId: repair.id, number: `${repair.number}.15`, suffixInt: 15, title: "Занято211" } });
  await assert.rejects(checkProductNumberRepairInTransaction(tx, { projectNumber: repair.number, operationId: randomUUID(), expectedSuffixes }), /COMPOSITION_COUNT|DESTINATION_OCCUPIED/);
  await tx.product.update({ where: { id: occupied.id }, data: { deletedAt: new Date() } });
  assert.ok(await checkProductNumberRepairInTransaction(tx, { projectNumber: repair.number, operationId: randomUUID(), expectedSuffixes }));

  const broken = await project();
  const brokenRows = [];
  for (const suffix of [1, 3]) brokenRows.push(await tx.product.create({ data: { projectId: broken.id,
    number: `${broken.number}.${suffix}`, suffixInt: suffix, title: "Откат аудита211", status: "PREPARATION" } }));
  const collision = await tx.changeLog.create({ data: { actorType: "system", actorId: actor.id, entity: "test", entityId: broken.id, action: "qa211.collision" } });
  const faulty = new Proxy(tx, { get(target, key) {
    if (key === "changeLog") return new Proxy(target.changeLog, { get(model, method) {
      if (method === "create") return () => tx.changeLog.create({ data: { id: collision.id,
        actorType: "system", actorId: actor.id, entity: "test", entityId: broken.id, action: "qa211.collision" } });
      const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
    } });
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await tx.$executeRawUnsafe("SAVEPOINT qa211_numbering_audit");
  await assert.rejects(core.createProductCore(actor, { projectId: broken.id, title: "Ошибка аудита211" }, run => run(faulty)), /Unique constraint|P2002/);
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa211_numbering_audit");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa211_numbering_audit");
  assert.deepEqual(await tx.product.findMany({ where: { projectId: broken.id }, orderBy: { suffixInt: "asc" } }), brokenRows);
  return { deletion: "7/15", numbering: "1..N", links: 3, historicalFactsPreserved: true, sqlAuditRollback: true, repair: "apply/replay/rollback/stale/occupied" };
}
