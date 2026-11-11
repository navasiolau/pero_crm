import assert from "node:assert/strict";
import test from "node:test";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import { createProductTechnicalEditor } from "../src/lib/product-technical-editor";
import type { ProductPatch, ProductPatchResult } from "../src/server/products/patch-contract";

const body = { id: "body", type: "body", group: "construction", label: "Корпус", value: "Берёза" } as const satisfies FurnitureSection;
const hardware = { id: "hardware", type: "hardware", group: "hardware", label: "Фурнитура", value: "" } as const satisfies FurnitureSection;
const initial: TechnicalSpecifications = { sections: [body, hardware], description: null, size: null, note: null, sourceGeneration: 1 };
const saved = (patch: ProductPatch): ProductPatchResult => ({
  kind: "saved", field: patch.field, value: "value" in patch ? patch.value : null, clientMutationId: patch.clientMutationId,
});

test("RSC обновляет чистые строки и сохраняет baseline черновиков и активных запросов", async () => {
  let acknowledge!: () => void;
  const patches: ProductPatch[] = [];
  const editor = createProductTechnicalEditor({
    productId: "product", initial, flushLegacy: async () => true,
    send: patch => {
      patches.push(patch);
      return new Promise(resolve => { acknowledge = () => resolve(saved(patch)); });
    },
  });
  const row = editor.section(body.id);
  row.setDraft("Дуб\nМасло");
  editor.receive({ ...initial, sections: [{ ...body, value: "Ясень" }, { ...hardware, value: "Петли" }], size: "1500 мм", sourceGeneration: 2 });
  assert.equal(row.getSnapshot().baseline, "Берёза");
  assert.equal(row.getSnapshot().draft, "Дуб\nМасло");
  assert.equal(editor.section(hardware.id).getSnapshot().baseline, "Петли");
  assert.equal(editor.source("size").getSnapshot().baseline, "1500 мм");

  const flushing = editor.flush();
  assert.deepEqual(patches.map(patch => patch.field === "technicalSpecificationValue" && [patch.field, patch.expectedValue, patch.value, patch.expectedSourceGeneration]), [
    ["technicalSpecificationValue", "Берёза", "Дуб\nМасло", 1],
  ]);
  editor.receive({ ...initial, sections: [hardware] });
  assert.equal(editor.getSnapshot().sections.find(section => section.id === body.id)?.value, "Берёза");
  acknowledge();
  assert.equal(await flushing, true);
  assert.equal(editor.getSnapshot().sections.find(section => section.id === body.id)?.value, "Дуб\nМасло");
  editor.receive({ ...initial, sections: [hardware] });
  assert.deepEqual(editor.getSnapshot().sections.map(section => section.id), [hardware.id]);
});

test("первый раздел сохраняется после legacy flush, повтор после потерянного ответа использует тот же запрос", async () => {
  const calls: Array<ProductPatch | "legacy"> = [];
  const newHardware = { ...hardware, id: "new-hardware" };
  const editor = createProductTechnicalEditor({
    productId: "product", initial: null, id: () => "mutation",
    flushLegacy: async () => { calls.push("legacy"); return true; },
    send: async patch => {
      calls.push(patch);
      if (calls.length === 2) throw Error("lost");
      return saved(patch);
    },
  });
  assert.equal(await editor.add(newHardware), false);
  assert.equal(editor.getSnapshot().structured, false);
  assert.equal(editor.getSnapshot().lockedLegacy, true);
  assert.equal(await editor.flush(), false);
  assert.equal(await editor.retry(), true);
  assert.deepEqual(calls, ["legacy", {
    productId: "product", clientMutationId: newHardware.id, field: "technicalSpecificationAdd", section: newHardware, expectedSourceGeneration: 0,
  }, {
    productId: "product", clientMutationId: newHardware.id, field: "technicalSpecificationAdd", section: newHardware, expectedSourceGeneration: 0,
  }]);
  assert.equal(editor.getSnapshot().structured, true);
  assert.equal(editor.getSnapshot().lockedLegacy, false);
  assert.deepEqual(editor.getSnapshot().sections, [newHardware]);
});

test("удаление сверяет полную подтверждённую строку, конфликт сохраняет строку и блокирует flush", async () => {
  const patches: ProductPatch[] = [];
  const editor = createProductTechnicalEditor({
    productId: "product", initial, flushLegacy: async () => true,
    send: async patch => {
      patches.push(patch);
      return patch.field === "technicalSpecificationRemove"
        ? { kind: "conflict", field: patch.field, clientMutationId: patch.clientMutationId, error: "Раздел изменился" }
        : saved(patch);
    },
  });
  editor.section(body.id).setDraft("Дуб");
  const confirmed = await editor.prepareRemove(body.id);
  assert.ok(confirmed);
  editor.receive({ ...initial, sections: [{ ...body, value: "Ясень" }, hardware], sourceGeneration: 2 });
  assert.equal(await editor.remove(confirmed), false);
  assert.equal(patches[0].field, "technicalSpecificationValue");
  const removal = patches[1];
  assert.ok(removal.field === "technicalSpecificationRemove");
  assert.deepEqual(removal.section, { ...body, value: "Дуб" });
  assert.equal(removal.expectedSourceGeneration, 1);
  assert.equal(editor.section(body.id).getSnapshot().baseline, "Ясень");
  assert.equal(editor.getSnapshot().sections.length, 2);
  assert.equal(await editor.flush(), false);
  editor.dismissIssue();
  assert.equal(await editor.flush(), true);
});

test("после синхронизации КП только чистые поля принимают новую версию источника", async () => {
  const patches: ProductPatch[] = [];
  const editor = createProductTechnicalEditor({
    productId: "product", initial, flushLegacy: async () => true,
    send: async patch => {
      patches.push(patch);
      if ("expectedSourceGeneration" in patch && patch.expectedSourceGeneration !== 2) {
        return { kind: "conflict", field: patch.field, clientMutationId: patch.clientMutationId, error: "Характеристики обновлены из КП" };
      }
      return saved(patch);
    },
  });
  const staleRow = editor.section(body.id);
  const staleNote = editor.source("note");
  staleRow.setDraft("Дуб");
  staleNote.setDraft("Свой текст");
  editor.receive({ ...initial, description: "Обновлённое описание", sourceGeneration: 2 });
  editor.section(hardware.id).setDraft("Петли");
  editor.source("description").setDraft("Моё описание");
  assert.equal(await editor.flush(), false);
  assert.equal(staleRow.getSnapshot().draft, "Дуб");
  assert.equal(staleNote.getSnapshot().draft, "Свой текст");
  assert.equal(staleRow.getSnapshot().currentValue, undefined);
  assert.equal(editor.section(hardware.id).getSnapshot().baseline, "Петли");
  assert.equal(editor.source("description").getSnapshot().baseline, "Моё описание");
  assert.deepEqual(patches.map(patch => {
    if (patch.field === "technicalSpecificationValue") return [patch.sectionId, patch.expectedSourceGeneration];
    if (patch.field === "technicalSpecificationSource") return [patch.source, patch.expectedSourceGeneration];
    return [];
  }), [["body", 1], ["hardware", 2], ["description", 2], ["note", 1]]);
});

test("новое воплощение стандартного раздела не получает контроллер удалённой строки", async () => {
  const editor = createProductTechnicalEditor({ productId: "product", initial, flushLegacy: async () => true, send: async patch => saved(patch) });
  const oldController = editor.section(body.id);
  const confirmed = await editor.prepareRemove(body.id);
  assert.ok(confirmed);
  assert.equal(await editor.remove(confirmed), true);
  const replacement = { ...body, id: "replacement", value: "" };
  assert.equal(await editor.add(replacement), true);
  assert.equal(editor.getSnapshot().sections.find(section => section.type === "body")?.id, replacement.id);
  assert.notEqual(editor.section(replacement.id), oldController);
  assert.equal(editor.section(replacement.id).getSnapshot().baseline, "");
});

test("конфликт одного раздела сохраняет ввод, а соседний раздел можно сохранить", async () => {
  const editor = createProductTechnicalEditor({
    productId: "product", initial, flushLegacy: async () => true,
    send: async patch => {
      if (patch.field === "technicalSpecificationValue" && patch.sectionId === body.id && patch.expectedValue === "Берёза") {
        return { kind: "conflict", field: patch.field, clientMutationId: patch.clientMutationId, error: "Раздел изменился", currentValue: "Ясень" };
      }
      return saved(patch);
    },
  });
  const row = editor.section(body.id);
  row.setDraft("Дуб");
  editor.section(hardware.id).setDraft("Петли");
  assert.equal(await editor.flush(), false);
  assert.equal(row.getSnapshot().draft, "Дуб");
  assert.equal(row.getSnapshot().currentValue, "Ясень");
  assert.equal(editor.section(hardware.id).getSnapshot().baseline, "Петли");
  assert.equal(await row.rebaseAndRetry(), true);
  assert.equal(await editor.flush(), true);
  assert.equal(row.getSnapshot().baseline, "Дуб");
});
