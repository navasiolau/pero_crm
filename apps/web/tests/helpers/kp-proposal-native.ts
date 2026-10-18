import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import type * as ProposalCore from "../../src/server/kp/proposal-core";
import { nativeSnapshot } from "./native-acceptance-snapshot";

/** Вызывается только внутри guarded rollback-транзакции; своих подключений не открывает. */
export async function verifyProposalCompositionNative(tx: Prisma.TransactionClient, actor: DomainActor,
  core: Pick<typeof ProposalCore, "createProposalInTransaction" | "saveProposalInTransaction">) {
  const prefix = `kp181-${randomUUID()}`;
  const temporary = await tx.client.create({ data: { id: `${prefix}-temporary`, name: "Временный", phone: "KP181_SYNTHETIC" } });
  const customer = await tx.client.create({ data: { id: `${prefix}-customer`, name: "Имя", lastName: "Фамилия", middleName: "Отчество", phone: "KP181_SAVED" } });
  const engineer = await tx.user.create({ data: { id: `${prefix}-engineer`, name: "Инженер КП181", email: `${prefix}@example.invalid`, passwordHash: "KP181_NO_LOGIN", roles: ["ENGINEER"] } });
  let pricingCalls = 0;
  const hooks = { environment: { PERO_KP_TEMP_CLIENT_ID: temporary.id }, applyPricing: async () => { pricingCalls++; return { changed: false }; } };
  const source = { order: { project: "Синтетическое КП181", number: "NOT_AUTHORITATIVE", address: "Адрес КП181" },
    client: { name: "Отображение", contact: "@opaque_contact" }, custom: { preserved: true },
    items: [{ id: randomUUID(), name: "Первое", qty: 2, size: "100/200", products: [{ title: "Секция", outer: "ЛДСП", inner: "МДФ" }] }, { id: randomUUID(), name: "Второе", qty: 1 }] };
  const initialMax = (await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt ?? 0;
  const request = { operationId: randomUUID(), clientId: customer.id, state: source };
  const created = await core.createProposalInTransaction(tx, actor, request, hooks);
  assert.equal(created.result.number, String(initialMax + 1)); assert.equal(created.result.projectId, created.result.number);
  assert.equal((created.result.state.order as Prisma.JsonObject).number, created.result.number);
  assert.deepEqual(created.result.state.custom, source.custom); assert.equal(created.result.items.length, 2);
  assert.equal(await tx.projectStageHistory.count({ where: { projectId: created.result.projectId, toStage: "LEAD" } }), 1);
  const firstId = created.result.items[0].productId, secondId = created.result.items[1].productId;
  const original = await tx.product.findUniqueOrThrow({ where: { id: firstId } });
  assert.equal(original.status, "DRAFT"); assert.equal(original.quantity, 2); assert.equal(original.expectedPrice, null);
  assert.equal(original.initialPrice, null); assert.equal(original.initialPriceCaptureEligible, true);
  assert.equal(await tx.productPercentageConfig.count({ where: { productId: firstId } }), 3);
  assert.match(original.description!, /Размеры: 100\/200/); assert.match(original.description!, /Каркас: ЛДСП/);
  assert.match(original.description!, /Фасад: МДФ/);
  const beforeReplay = await nativeSnapshot(tx);
  const replayed = await core.createProposalInTransaction(tx, actor, request, hooks);
  assert.deepEqual(replayed.result, { ...created.result, repeated: true }); assert.deepEqual(await nativeSnapshot(tx), beforeReplay);
  assert.equal(pricingCalls, 1);

  await tx.product.update({ where: { id: firstId }, data: { status: "DESIGN", engineerId: engineer.id } });
  const manual = await tx.product.create({ data: { projectId: created.result.projectId, number: `${created.result.number}.99`, suffixInt: 99,
    title: "Добавлено только в CRM", status: "DRAFT" } });
  const historyCount = await tx.productStatusHistory.count({ where: { productId: firstId } });
  const reducedState = { ...created.result.state, items: [created.result.state.items[1]] };
  const reduced = await core.saveProposalInTransaction(tx, actor, { proposalId: created.result.proposalId,
    expectedRevision: created.result.revision, operationId: randomUUID(), state: reducedState }, hooks);
  assert.equal(reduced.result.items[0].productId, secondId); assert.equal(reduced.result.items[0].number, `${created.result.number}.1`);
  const hidden = await tx.product.findUniqueOrThrow({ where: { id: firstId } });
  assert.ok(hidden.deletedAt); assert.equal(hidden.number, reduced.result.items[0].number, "hidden history can share the human number");
  assert.equal(hidden.status, "DESIGN"); assert.equal(hidden.engineerId, engineer.id);
  assert.ok((await tx.product.findUniqueOrThrow({ where: { id: manual.id } })).deletedAt);
  await tx.client.update({ where: { id: customer.id }, data: { phone: "MANUAL_CHANGE" } });
  let restored = await core.saveProposalInTransaction(tx, actor, { proposalId: reduced.result.proposalId,
    expectedRevision: reduced.result.revision, operationId: randomUUID(), state: { ...reduced.result.state, items: created.result.state.items } }, hooks);
  assert.deepEqual(restored.result.items.map(item => item.productId), [firstId, secondId]);
  const live = await tx.product.findUniqueOrThrow({ where: { id: firstId } });
  assert.equal(live.deletedAt, null); assert.equal(live.status, "DESIGN"); assert.equal(live.engineerId, engineer.id);
  assert.equal(live.createdAt.toISOString(), original.createdAt.toISOString());
  assert.equal(await tx.productStatusHistory.count({ where: { productId: firstId } }), historyCount);
  assert.equal((await tx.client.findUniqueOrThrow({ where: { id: customer.id } })).phone, "KP181_SAVED");
  const swapped = await core.saveProposalInTransaction(tx, actor, { proposalId: restored.result.proposalId, expectedRevision: restored.result.revision,
    operationId: randomUUID(), state: { ...restored.result.state, items: [...restored.result.state.items].reverse() } }, hooks);
  assert.deepEqual(await tx.proposalItem.findMany({ where: { proposalId: restored.result.proposalId, deletedAt: null }, select: { id: true, position: true }, orderBy: { position: "asc" } }),
    [{ id: source.items[1].id, position: 1 }, { id: source.items[0].id, position: 2 }]);
  restored = await core.saveProposalInTransaction(tx, actor, { proposalId: swapped.result.proposalId, expectedRevision: swapped.result.revision,
    operationId: randomUUID(), state: { ...swapped.result.state, items: created.result.state.items } }, hooks);

  const unchangedInput = { proposalId: restored.result.proposalId, expectedRevision: restored.result.revision,
    operationId: randomUUID(), state: restored.result.state };
  const productsBeforeNoop = await tx.product.findMany({ where: { projectId: restored.result.projectId }, orderBy: { id: "asc" } });
  const eventsBeforeNoop = await tx.domainEvent.count({ where: { actor: actor.id } });
  const noop = await core.saveProposalInTransaction(tx, actor, unchangedInput, hooks);
  assert.equal(noop.result.noOp, true); assert.equal(noop.result.revision, restored.result.revision);
  assert.deepEqual(await tx.product.findMany({ where: { projectId: restored.result.projectId }, orderBy: { id: "asc" } }), productsBeforeNoop);
  assert.equal(await tx.domainEvent.count({ where: { actor: actor.id } }), eventsBeforeNoop);
  const beforeNoopReplay = await nativeSnapshot(tx);
  assert.equal((await core.saveProposalInTransaction(tx, actor, unchangedInput, hooks)).result.repeated, true);
  assert.deepEqual(await nativeSnapshot(tx), beforeNoopReplay);

  await tx.$executeRawUnsafe("SAVEPOINT kp181_failed_save");
  const beforeFailure = await nativeSnapshot(tx);
  try {
    await assert.rejects(core.saveProposalInTransaction(tx, actor, { ...unchangedInput, operationId: randomUUID(),
      clientSnapshot: { name: "Не должно сохраниться" }, state: { ...restored.result.state, items: [{ ...restored.result.state.items[1], name: "Не сохранять" }] } },
    { ...hooks, applyMedia: async () => { throw Error("KP181_INJECTED_MEDIA_FAILURE"); } }), /KP181_INJECTED_MEDIA_FAILURE/);
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT kp181_failed_save");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT kp181_failed_save");
  }
  assert.deepEqual(await nativeSnapshot(tx), beforeFailure, "client, composition, revision, audit and outbox roll back together");

  await tx.$executeRawUnsafe("SAVEPOINT kp181_failed_create");
  const maxBeforeFailure = (await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt;
  try {
    await assert.rejects(core.createProposalInTransaction(tx, actor, { operationId: randomUUID(), state: { items: [] } },
      { ...hooks, applyPricing: async () => { throw Error("KP181_INJECTED_PRICING_FAILURE"); } }), /KP181_INJECTED_PRICING_FAILURE/);
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT kp181_failed_create");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT kp181_failed_create");
  }
  assert.equal((await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt, maxBeforeFailure);
  const afterRollback = await core.createProposalInTransaction(tx, actor, { operationId: randomUUID(), state: { items: [] } }, hooks);
  assert.equal(afterRollback.result.number, String(Number(maxBeforeFailure) + 1));
  assert.equal((await tx.client.findUniqueOrThrow({ where: { id: temporary.id } })).name, "Временный");
  await tx.project.update({ where: { id: restored.result.projectId }, data: { stage: "ESTIMATE" } });
  const beforeLocked = await nativeSnapshot(tx);
  await assert.rejects(core.saveProposalInTransaction(tx, actor, { ...unchangedInput, operationId: randomUUID() }, hooks), /только в проекте/);
  assert.deepEqual(await nativeSnapshot(tx), beforeLocked);
  return { activeNumberUniqueness: true, replay: true, noOpReceipt: true, sameIdRestore: true,
    clientSnapshotRestored: true, quantity: 2, rollbackNoNumberSpent: true, atomicFailureRollback: true, pricingCalls };
}
