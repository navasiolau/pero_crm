import assert from "node:assert/strict";
import test from "node:test";
import { buildJournalPresentation, formatJournalDisplayValue } from "../src/server/changelog/presentation";
import { FULL_SHARE_UNITS } from "../src/lib/work-shares";
import { PERCENTAGE_SHARE_UNITS } from "../src/lib/product-percentage-pay";

const entry = { actorType: "user", actorId: "author", entityId: "entity", action: "create" };

test("доли логистики и исполнителей отображаются точными процентами без изменения снимка", () => {
  assert.equal(FULL_SHARE_UNITS, 1_000_000);
  assert.equal(PERCENTAGE_SHARE_UNITS, 1_000_000);
  const raw = { allocations: [{ percentBps: 3333 }, { percentBps: 6667 }], amount: "100.01" };
  const before = structuredClone(raw);
  const view = buildJournalPresentation({ ...entry, entity: "logisticsPosting", newValue: raw });
  assert.deepEqual(view.changes.find(change => change.path === "allocations")?.after, [{ percentBps: "33,33 %" }, { percentBps: "66,67 %" }]);
  assert.deepEqual(raw, before);
  for (const entity of ["product", "payrollEntry", "task", "taskAllocationGroup", "work"]) {
    const shares = buildJournalPresentation({ ...entry, entity, newValue: { shareUnits: 500001, quantity: 500001 } });
    assert.equal(shares.changes.find(change => change.path === "shareUnits")?.after, "50,0001 %");
    assert.equal(shares.changes.find(change => change.path === "quantity")?.after, 500001);
  }
});

test("повторное обновление представления не меняет проценты, переводы и сохранённые имена", () => {
  const logistics = { shares: [{ projectId: "Проект 203", percentBps: 3333 }, { projectId: "Проект 204", percentBps: 6667 }],
    state: "READY", comment: "Сохранённое полное название" };
  const rendered = formatJournalDisplayValue(logistics, "manifest", "logisticsPosting");
  assert.deepEqual(formatJournalDisplayValue(rendered, "manifest", "logisticsPosting"), rendered);
  assert.deepEqual(rendered, { shares: [{ projectId: "Проект 203", percentBps: "33,33 %" }, { projectId: "Проект 204", percentBps: "66,67 %" }],
    state: "Готово", comment: "Сохранённое полное название" });
  const product = { recipientId: "Историческое имя", shareUnits: 500001, state: "LEGACY_PROTECTED" };
  const formattedProduct = formatJournalDisplayValue(product, "", "product");
  assert.deepEqual(formatJournalDisplayValue(formattedProduct, "", "product"), formattedProduct);
  assert.deepEqual(formattedProduct, { recipientId: "Историческое имя", shareUnits: "50,0001 %", state: "Защищено историческим начислением" });
});

test("неизвестные домены, неверные значения и обычные проценты не переинтерпретируются", () => {
  for (const entity of ["plugin", "orgSetting"]) {
    const view = buildJournalPresentation({ ...entry, entity, newValue: { shareUnits: 250000, percentBps: 2500 } });
    assert.equal(view.changes.find(change => change.path === "shareUnits")?.after, 250000);
    assert.equal(view.changes.find(change => change.path === "percentBps")?.after, 2500);
  }
  for (const value of [-1, 10001, 0.1, "не число"]) {
    const view = buildJournalPresentation({ ...entry, entity: "logisticsTrip", newValue: { percentBps: value } });
    assert.equal(view.changes[0].after, value);
  }
  const view = buildJournalPresentation({ ...entry, entity: "product", newValue: { ratePercent: "2.50", shareUnits: "1000000" } });
  assert.equal(view.changes.find(change => change.path === "ratePercent")?.after, "2.50");
  assert.equal(view.changes.find(change => change.path === "shareUnits")?.after, "100 %");
});
