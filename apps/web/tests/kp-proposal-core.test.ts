import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createProposalInTransaction, saveProposalInTransaction } from "../src/server/kp/proposal-core";
import { createProjectInTransaction } from "../src/server/projects/core";
import { createProductInTransaction, patchProductCore } from "../src/server/products/core";
import { promoteProjectDrafts } from "../src/server/products/draft-core";
import type { ProposalWriteResult } from "../src/server/kp/proposal-contract";
import { proposalFixture, type FixtureRow } from "./helpers/kp-proposal-fixture";

const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "api" as const };
type Fixture = ReturnType<typeof proposalFixture>;
const state = (items: unknown[] = []) => ({ order: { project: "Заказ", number: "999", address: "Адрес объекта" }, client: { name: "Получатель", contact: "@contact" }, items });
async function create(f: Fixture, items: unknown[] = [], extra = {}) {
  return f.transaction(tx => createProposalInTransaction(tx, actor, { operationId: randomUUID(), state: state(items), ...extra }, f.hooks));
}
async function save(f: Fixture, baseline: ProposalWriteResult, nextState = baseline.state, extra = {}) {
  return f.transaction(tx => saveProposalInTransaction(tx, actor, { operationId: randomUUID(), proposalId: baseline.proposalId,
    expectedRevision: baseline.revision, state: nextState, ...extra }, f.hooks));
}
function product(f: Fixture, id: string): FixtureRow {
  const row = f.state.products.find(row => row.id === id); assert.ok(row); return row;
}

test("shared project and quote allocator includes soft-deleted numbers; rollback never spends a number", async () => {
  const f = proposalFixture();
  const [normal, quote] = await Promise.all([
    f.transaction(tx => createProjectInTransaction(tx, actor, { title: "Обычный проект", clientId: "customer" })),
    create(f),
  ]);
  assert.equal(normal.project.number, "231"); assert.equal(quote.result.number, "232");
  assert.equal(quote.result.projectId, "232"); assert.equal((quote.result.state.order as Record<string, unknown>).number, "232");
  assert.equal(f.state.products.length, 0); assert.equal(quote.result.revision, 0);
  f.state.failEventType = "kp.created";
  const before = f.cloneState(); await assert.rejects(create(f), /OUTBOX_FAILED/); assert.deepEqual(f.cloneState(), before);
  f.state.failEventType = "";
  assert.equal((await create(f)).result.number, "233");
  assert.ok(f.state.sql.some(sql => sql.includes("pg_advisory_xact_lock(18435, 55001)")));
  assert.equal(f.state.logs.filter(log => log.entity === "project" && log.action === "create").length, 3);
});

test("single creation preserves defaults/history and idempotent replay returns originally assigned item IDs", async () => {
  const f = proposalFixture(); const input = { operationId: randomUUID(), state: state([{ name: "Шкаф", qty: 3,
    products: [{ title: "Секция", outer: "Каркас", inner: "Фасад" }], custom: { preserved: true } }]) };
  const first = await f.transaction(tx => createProposalInTransaction(tx, actor, input, f.hooks));
  const before = f.cloneState(); const replay = await f.transaction(tx => createProposalInTransaction(tx, actor, input, f.hooks));
  assert.deepEqual(replay.result, { ...first.result, repeated: true }); assert.deepEqual(replay.eventIds, []);
  assert.equal(f.state.products.length, 1); assert.equal(f.state.proposals.length, 1); assert.equal(f.state.items.length, 1);
  assert.equal(f.state.logs.length, before.logs.length); assert.equal(f.state.events.length, before.events.length);
  assert.equal(f.state.pricingCalls, 1); assert.equal(first.result.items[0].number, "231.1");
  const created = product(f, first.result.items[0].productId);
  assert.equal(created.status, "DRAFT"); assert.equal(created.quantity, 3); assert.equal(created.initialPrice, null);
  assert.equal(created.initialPriceCaptureEligible, true, "unpriced draft is not assigned a free price");
  assert.deepEqual((created.percentageConfigs as { create: unknown[] }).create, ["ENGINEERING", "ASSEMBLY", "INSTALLATION"].map(kind => ({ kind, ratePercent: "0.00", revision: 1 })));
  assert.equal(f.state.statusHistory.length, 1);
  await assert.rejects(f.transaction(tx => createProposalInTransaction(tx, actor, { ...input, state: state([]) }, f.hooks)), /уже использован/);
});

test("existing legacy state converts once, then clear, stale writer, replay and historical restore preserve the source", async () => {
  const f = proposalFixture();
  const blocks = [{ title: "Секция А", outer: "Наружное покрытие", inner: "Внутренняя плита" }];
  const first = await create(f, [{ id: "one", name: "Изделие", products: blocks }]);
  const legacyItem = { ...first.result.state.items[0] };
  delete legacyItem.specifications;
  const historic = { ...first.result.state, items: [legacyItem] };
  const historicBefore = structuredClone(historic);
  // Имитируем текущий снимок, сохранённый до введения структурированных характеристик.
  f.state.proposals[0].state = structuredClone(historic);
  const command = { proposalId: first.result.proposalId, operationId: randomUUID(), expectedRevision: first.result.revision, state: historic };
  const converted = await f.transaction(tx => saveProposalInTransaction(tx, actor, command, f.hooks));
  const item = converted.result.state.items[0];
  assert.deepEqual(item.products, blocks);
  assert.ok(Array.isArray(item.specifications) && item.specifications.length);
  assert.match(JSON.stringify(item.specifications), /Наружное покрытие/);
  assert.match(JSON.stringify(item.specifications), /Внутренняя плита/);
  assert.ok(item.specifications.every(section => (section as { type: string }).type === "custom"));
  assert.deepEqual(f.state.proposals[0].state, converted.result.state, "ACK совпадает с сохранённым снимком");
  const productId = converted.result.items[0].productId;
  assert.deepEqual((product(f, productId).technicalSpecifications as { sections: unknown[] }).sections, item.specifications);
  const beforeReplay = f.cloneState();
  assert.deepEqual((await f.transaction(tx => saveProposalInTransaction(tx, actor, command, f.hooks))).result,
    { ...converted.result, repeated: true });
  assert.deepEqual({ ...f.cloneState(), sql: [] }, { ...beforeReplay, sql: [] });

  for (const outdated of [legacyItem, { ...item, products: [{ outer: "Устаревшее изменение" }] }]) {
    const before = f.cloneState();
    await assert.rejects(save(f, converted.result, { ...converted.result.state, items: [outdated] }), {
      kind: "editor-outdated", message: /обновите редактор/,
    });
    assert.deepEqual(f.cloneState(), before);
  }
  const cleared = await save(f, converted.result, { ...converted.result.state, items: [{ ...item, specifications: [] }] });
  assert.deepEqual(cleared.result.state.items[0].specifications, []);
  assert.deepEqual(cleared.result.state.items[0].products, blocks);
  assert.deepEqual((product(f, productId).technicalSpecifications as { sections: unknown[] }).sections, []);
  assert.equal((await save(f, cleared.result)).result.noOp, true);

  const restored = await f.transaction(tx => saveProposalInTransaction(tx, actor, {
    ...command, operationId: randomUUID(), expectedRevision: cleared.result.revision,
  }, { ...f.hooks, restoreVersion: true }));
  assert.deepEqual(restored.result.state.items[0].specifications, item.specifications, "исторический снимок даёт те же ID");
  assert.deepEqual((product(f, productId).technicalSpecifications as { sections: unknown[] }).sections, item.specifications);
  assert.deepEqual(historic, historicBefore);
});

test("save mirrors active composition, reorders human numbers, and restores original IDs/status/facts", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Первое" }, { id: "two", name: "Второе" }]);
  const one = first.result.items[0].productId, two = first.result.items[1].productId;
  product(f, one).engineerId = "engineer"; product(f, one).status = "DESIGN";
  f.state.financialFacts.push({ id: "payroll", productId: one, amount: "100.00", frozenRate: "1.25" });
  const manual = await f.transaction(tx => createProductInTransaction(tx, actor, { projectId: first.result.projectId, title: "Только CRM" }));
  assert.equal(manual.ok, true); if (!manual.ok) throw Error("manual fixture");
  const facts = structuredClone(f.state.financialFacts), history = structuredClone(f.state.statusHistory);
  const second = await save(f, first.result, { ...first.result.state, items: [first.result.state.items[1]] });
  assert.equal(product(f, two).number, "231.1"); assert.ok(product(f, one).deletedAt); assert.ok(product(f, manual.product.id).deletedAt);
  assert.equal(f.state.items.find(row => row.id === "one")?.deletedAt instanceof Date, true);
  assert.equal(product(f, one).status, "DESIGN"); assert.equal(product(f, one).engineerId, "engineer");
  const third = await save(f, second.result, { ...second.result.state, items: [first.result.state.items[0], first.result.state.items[1]] });
  assert.deepEqual(third.result.items.map(item => [item.id, item.productId, item.number]), [["one", one, "231.1"], ["two", two, "231.2"]]);
  assert.equal(product(f, one).deletedAt, null); assert.equal(product(f, one).status, "DESIGN");
  assert.deepEqual(f.state.financialFacts, facts); assert.deepEqual(f.state.statusHistory, history);
  assert.equal(f.state.products.length, 3); assert.ok(product(f, manual.product.id).deletedAt);
  assert.ok(third.changedProducts.some(row => row.id === two && row.previousNumbers.includes("231.1")));
});

test("number swaps use two phases under active uniqueness", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Первое" }, { id: "two", name: "Второе" }]);
  const second = await save(f, first.result, { ...first.result.state, items: [first.result.state.items[1], first.result.state.items[0]] });
  assert.deepEqual(second.result.items.map(item => [item.id, item.number]), [["two", "231.1"], ["one", "231.2"]]);
  assert.equal(new Set(f.state.products.filter(row => !row.deletedAt).map(row => row.number)).size, 2);
  assert.ok(f.state.products.every(row => !String(row.number).startsWith("__kp_sync_")));
  assert.deepEqual(f.state.items.filter(row => !row.deletedAt).sort((a, b) => Number(a.position) - Number(b.position)).map(row => [row.id, row.position]), [["two", 1], ["one", 2]]);
});

test("locked product snapshot restores manual edits committed before the Product lock", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Исходное" }]);
  const productId = first.result.items[0].productId;
  f.beforeProductLock(() => { product(f, productId).title = "Изменено перед получением блокировки"; });
  const saved = await save(f, first.result);
  assert.equal(saved.result.noOp, false); assert.equal(product(f, productId).title, "Исходное");
  const sql = f.state.sql.slice().reverse();
  assert.ok(sql.findIndex(value => value.includes('FROM "Product"') && value.includes("FOR UPDATE")) < sql.findIndex(value => value.includes("pg_advisory_xact_lock_shared")));
});

test("quantity recalculation uses the locked latest quantity, not the pre-lock count", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Партия", qty: 2 }]);
  const productId = first.result.items[0].productId;
  f.state.works.push({ id: "work", productId, title: "Работа", paymentKind: "LEGACY", quantity: "4.00", quantityPerUnit: "2.00", priceSnapshot: "10.00", total: "40.00", tasks: [] });
  f.state.materials.push({ id: "material", productId, quantity: "6.000", quantityPerUnit: "3.000", issuedQty: "0.000", material: { name: "Материал" } });
  f.beforeProductLock(() => {
    product(f, productId).quantity = 4; f.state.works[0].quantity = "8.00"; f.state.materials[0].quantity = "12.000";
  });
  await save(f, first.result);
  assert.equal(product(f, productId).quantity, 2); assert.equal(f.state.works[0].quantity, "4.00"); assert.equal(f.state.works[0].quantityPerUnit, "2.00");
  assert.equal(f.state.materials[0].quantity, "6.000"); assert.equal(f.state.materials[0].quantityPerUnit, "3.000");
});

test("warehouse freeze permits unchanged text save but rejects a latest quantity that needs mirroring", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Партия", qty: 2 }]);
  f.state.warehousePhase = "FROZEN";
  assert.equal((await save(f, first.result)).result.noOp, true);
  f.beforeProductLock(() => { product(f, first.result.items[0].productId).quantity = 4; });
  await assert.rejects(save(f, first.result), /Склад временно/);
});

test("quantity uses shared work/material recalculation and rejects an unsafe change atomically", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Партия", qty: 2 }]);
  const productId = first.result.items[0].productId;
  f.state.works.push({ id: "work", productId, title: "Работа", paymentKind: "LEGACY", quantity: "4.00", quantityPerUnit: "2.00", priceSnapshot: "10.00", total: "40.00", tasks: [] });
  f.state.materials.push({ id: "material", productId, quantity: "6.000", quantityPerUnit: "3.000", issuedQty: "4.000", material: { name: "Материал" } });
  const changed = await save(f, first.result, { ...first.result.state, items: [{ ...first.result.state.items[0], qty: 3 }] });
  assert.equal(product(f, productId).quantity, 3); assert.equal(f.state.works[0].quantity, "6.00"); assert.equal(f.state.works[0].total, "60.00");
  assert.equal(f.state.materials[0].quantity, "9.000");
  const before = f.cloneState();
  await assert.rejects(save(f, changed.result, { ...changed.result.state, items: [{ ...changed.result.state.items[0], qty: 1 }] }), /уже выдано/);
  assert.deepEqual(f.cloneState(), before);
  f.state.warehousePhase = "FROZEN";
  await assert.rejects(save(f, changed.result, { ...changed.result.state, items: [{ ...changed.result.state.items[0], qty: 4 }] }), /Склад временно/);
});

test("role, live binding, current LEAD and revision guards reject without a partial write", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Изделие" }]);
  for (const roles of [["ENGINEER"], ["ACCOUNTANT"], ["WORKER"]] as const) {
    const before = f.cloneState();
    await assert.rejects(f.transaction(tx => saveProposalInTransaction(tx, { ...actor, roles: [...roles] }, {}, f.hooks)), /Недостаточно прав/);
    assert.deepEqual(f.cloneState(), before);
  }
  await assert.rejects(save(f, first.result, first.result.state, { expectedRevision: 99 }), /изменено другим/);
  const project = f.state.projects.find(row => row.id === first.result.projectId)!;
  project.stage = "ESTIMATE"; const before = f.cloneState(); await assert.rejects(save(f, first.result), /только в проекте/); assert.deepEqual(f.cloneState(), before);
  f.state.projects.find(row => row.id === first.result.projectId)!.stage = "LEAD"; assert.equal((await save(f, first.result)).result.ok, true);
  f.state.proposals[0].isArchive = true;
  assert.equal((await save(f, first.result, { ...first.result.state, items: [{ ...first.result.state.items[0], name: "Изменено" }] })).result.revision, 1);
  f.state.projects.find(row => row.id === first.result.projectId)!.deletedAt = new Date(0);
  await assert.rejects(save(f, first.result), /недоступны/);
});

test("no-op records a replay receipt, executes composed pricing and leaves item/product timestamps untouched", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Изделие" }]);
  const input = { operationId: randomUUID(), proposalId: first.result.proposalId, expectedRevision: first.result.revision, state: first.result.state };
  const writeCount = f.state.writes.length, events = f.state.events.length, logs = f.state.logs.length;
  const second = await f.transaction(tx => saveProposalInTransaction(tx, actor, input, f.hooks));
  assert.equal(second.result.noOp, true); assert.equal(second.result.revision, first.result.revision);
  assert.equal(f.state.pricingCalls, 2); assert.equal(f.state.writes.length, writeCount); assert.equal(f.state.events.length, events);
  assert.equal(f.state.logs.length, logs + 1);
  const replay = await f.transaction(tx => saveProposalInTransaction(tx, actor, input, f.hooks));
  assert.equal(replay.result.repeated, true); assert.equal(f.state.pricingCalls, 2); assert.equal(f.state.logs.length, logs + 1);
  f.state.projects.find(row => row.id === first.result.projectId)!.stage = "CONTRACT";
  assert.equal((await f.transaction(tx => saveProposalInTransaction(tx, actor, input, f.hooks))).result.repeated, true, "ACK of committed write is not a new write");
});

test("unchanged source still restores manual CRM edits and pricing changes participate in revision", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Изделие" }], { clientId: "customer" });
  product(f, first.result.items[0].productId).title = "Ручное изменение CRM";
  f.state.clients.find(row => row.id === "customer")!.phone = "+375000000099";
  const updated = await save(f, first.result);
  assert.equal(updated.result.noOp, false); assert.equal(updated.result.revision, 1);
  assert.equal(product(f, first.result.items[0].productId).title, "Изделие");
  assert.equal(f.state.clients.find(row => row.id === "customer")!.phone, "+375000000000");
  const priced = await f.transaction(tx => saveProposalInTransaction(tx, actor, { operationId: randomUUID(),
    proposalId: updated.result.proposalId, expectedRevision: updated.result.revision, state: updated.result.state },
  { ...f.hooks, pricingFingerprint: "new-fixed-rate", applyPricing: async () => ({ changed: true }) }));
  assert.equal(priced.result.revision, 2);
});

test("legacy projection preserves the raw Product text, clears absent fields, and participates in revision and audit", async () => {
  const f = proposalFixture();
  const initial = await create(f, [{ id: "one", name: "Изделие", description: "<b>Описание</b>", size: "100/200", note: "Исходное",
    products: [{ title: "Каркас", outer: "Дуб", unknown: { retained: true } }] }]);
  const id = initial.result.items[0].productId;
  const raw = "  старый\r\n<b>текст</b>  ";
  const row = product(f, id);
  assert.equal(row.description, null);
  const projected = { description: "<b>Описание</b>", size: "100/200", note: "Исходное", sourceGeneration: 1,
    sections: [{ id: "body", type: "body", group: "construction", label: "Корпус", value: "Дуб" }] };
  assert.deepEqual(row.technicalSpecifications, projected);
  assert.deepEqual(initial.result.state.items[0].products, [{ title: "Каркас", outer: "Дуб", unknown: { retained: true } }]);
  row.description = raw;
  const manual = { ...projected, note: "Ручная правка" };
  row.technicalSpecifications = manual;
  const restored = await save(f, initial.result);
  assert.equal(restored.result.revision, initial.result.revision + 1);
  assert.equal(product(f, id).description, raw);
  assert.deepEqual(product(f, id).technicalSpecifications, { ...projected, sourceGeneration: 2 });
  const audit = f.state.logs.filter(log => log.entityId === id && log.action === "kp.synchronize").at(-1);
  assert.deepEqual((audit?.oldValue as Record<string, unknown>).technicalSpecifications, manual);
  assert.deepEqual((audit?.newValue as Record<string, unknown>).technicalSpecifications, { ...projected, sourceGeneration: 2 });
  assert.equal((await save(f, restored.result)).result.noOp, true);

  const cleared = await save(f, restored.result, { ...restored.result.state,
    items: [{ id: "one", name: "Изделие", qty: 1, specifications: [], products: restored.result.state.items[0].products }] });
  assert.equal(cleared.result.noOp, false);
  assert.equal(product(f, id).description, raw);
  assert.deepEqual(product(f, id).technicalSpecifications, { description: null, size: null, note: null, sections: [], sourceGeneration: 3 });
});

test("proposal sync blocks a stale value patch even when a deleted legacy row returns with identical ID and value", async () => {
  const f = proposalFixture();
  const initial = await create(f, [{ id: "one", name: "Изделие", products: [{ title: "Каркас" }] }]);
  const productId = initial.result.items[0].productId;
  const body = { id: "body", type: "body", group: "construction", label: "Корпус", value: "" } as const;
  const stale = { productId, clientMutationId: randomUUID(), field: "technicalSpecificationValue",
    sectionId: "body", expectedValue: "", value: "Запоздавшая запись", expectedSourceGeneration: 1 } as const;
  const remove = { productId, clientMutationId: randomUUID(), field: "technicalSpecificationRemove",
    section: body, expectedSourceGeneration: 1 } as const;
  const removed = await patchProductCore(actor, remove, f.transaction);
  assert.equal(removed.kind, "saved");
  assert.deepEqual(product(f, productId).technicalSpecifications, {
    description: null, size: null, note: null, sections: [], sourceGeneration: 1,
  });
  const restored = await save(f, initial.result);
  assert.equal(restored.result.noOp, false);
  const synced = { description: null, size: null, note: null, sections: [body], sourceGeneration: 2 };
  assert.deepEqual(product(f, productId).technicalSpecifications, synced);
  assert.equal((await patchProductCore(actor, stale, f.transaction)).kind, "conflict");
  assert.deepEqual(await patchProductCore(actor, remove, f.transaction), { ...removed, repeated: true });
  assert.deepEqual(product(f, productId).technicalSpecifications, synced);
  assert.equal((await save(f, restored.result)).result.noOp, true);
  assert.deepEqual(product(f, productId).technicalSpecifications, synced);
});

test("hook, CAS and outbox failures roll back project/client/composition and receipts together", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Изделие" }], { clientId: "customer" });
  const next = { ...first.result.state, items: [{ ...first.result.state.items[0], name: "Другое" }] };
  for (const failure of ["pricing", "media", "cas", "outbox"]) {
    f.state.forceCasFailure = failure === "cas"; f.state.failEventType = failure === "outbox" ? "kp.updated" : "";
    const before = f.cloneState();
    await assert.rejects(f.transaction(tx => saveProposalInTransaction(tx, actor, { operationId: randomUUID(), proposalId: first.result.proposalId,
      expectedRevision: first.result.revision, state: next, clientSnapshot: { name: "Новое имя" } }, { ...f.hooks,
      applyPricing: failure === "pricing" ? async () => { throw Error("PRICING_FAILED"); } : f.hooks.applyPricing,
      applyMedia: failure === "media" ? async () => { throw Error("MEDIA_FAILED"); } : undefined,
    })));
    assert.deepEqual(f.cloneState(), before);
  }
});

test("foreign item IDs and cross-project product bindings never synchronize another project", async () => {
  const f = proposalFixture(); const one = await create(f, [{ id: "one", name: "Первое" }]);
  const two = await create(f, [{ id: "two", name: "Второе" }]); const before = f.cloneState();
  await assert.rejects(save(f, one.result, { ...one.result.state, items: [two.result.state.items[0]] }), /другому КП/);
  assert.deepEqual(f.cloneState(), before);
  f.state.items.find(row => row.id === "one")!.productId = two.result.items[0].productId;
  const forged = f.cloneState(); await assert.rejects(save(f, one.result), /не принадлежит проекту/); assert.deepEqual(f.cloneState(), forged);
});

test("contract promotion excludes hidden drafts in selection and conditional update", async () => {
  const f = proposalFixture(); const first = await create(f, [{ id: "one", name: "Первое" }, { id: "two", name: "Второе" }]);
  await save(f, first.result, { ...first.result.state, items: [first.result.state.items[1]] });
  const hidden = first.result.items[0].productId, live = first.result.items[1].productId;
  const before = f.state.statusHistory.length;
  const promoted = await f.transaction(tx => promoteProjectDrafts(tx, actor, first.result.projectId, new Date(1)));
  assert.deepEqual(promoted.productIds, [live]); assert.equal(product(f, hidden).status, "DRAFT"); assert.equal(product(f, live).status, "PREPARATION");
  assert.equal(f.state.statusHistory.length, before + 1);
});
