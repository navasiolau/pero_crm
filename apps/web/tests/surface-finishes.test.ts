import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFinishAssignment, validateFinishAssignments } from "../src/lib/surface-finishes";

const enamel = { itemId: "part-1", surfaceKind: "FACE", surfaceLabel: " Лицевая ", layerOrder: 1,
  finishKind: "ENAMEL", name: " Белый ", code: " RAL 9016 ", colorHex: "#f1f0ea", sampleFileId: null };

test("finish normalization keeps named codes and canonical surface/color without inventing a sample", () => {
  const value = normalizeFinishAssignment(enamel);
  assert.equal(value.surfaceLabel, "Лицевая");
  assert.equal(value.normalizedSurfaceLabel, "ЛИЦЕВАЯ");
  assert.equal(value.name, "Белый");
  assert.equal(value.code, "RAL 9016");
  assert.equal(value.colorHex, "#F1F0EA");
  assert.equal(value.sampleFileId, null);
  const withoutSample = normalizeFinishAssignment({ ...enamel, colorHex: "", sampleFileId: " " });
  assert.equal(withoutSample.colorHex, null);
  assert.equal(withoutSample.sampleFileId, null);
  assert.equal(withoutSample.code, "RAL 9016");
  assert.equal(enamel.name, " Белый "); // input remains unchanged
});

test("material name and code preserve № and superscript ² after trimming", () => {
  const value = normalizeFinishAssignment({
    ...enamel,
    name: "  Фасад № ²  ",
    code: "  RAL № 9016²  ",
  });
  assert.equal(value.name, "Фасад № ²");
  assert.equal(value.code, "RAL № 9016²");
  assert.notEqual(value.name, value.name.normalize("NFKC"));
  assert.notEqual(value.code, value.code.normalize("NFKC"));
});

test("whole-element surface has one canonical identity", () => {
  const value = normalizeFinishAssignment({ ...enamel, surfaceKind: "WHOLE", surfaceLabel: "" });
  assert.equal(value.surfaceLabel, "Целиком");
  assert.equal(value.normalizedSurfaceLabel, "ЦЕЛИКОМ");
});

test("veneer and lacquer coexist as independent ordered layers without child inheritance", () => {
  const layers = validateFinishAssignments([
    { ...enamel, finishKind: "VENEER", name: "Дуб", code: "OAK-01", colorHex: null, sampleFileId: "image-1" },
    { ...enamel, layerOrder: 2, finishKind: "COATING", name: "Лак матовый", code: "L-10", colorHex: null },
  ]);
  assert.equal(layers.length, 2);
  assert.deepEqual(layers.map((layer) => [layer.itemId, layer.layerOrder, layer.finishKind, layer.code]),
    [["part-1", 1, "VENEER", "OAK-01"], ["part-1", 2, "COATING", "L-10"]]);
  assert.equal(layers[0].sampleFileId, "image-1");
  assert.equal(layers[1].sampleFileId, null);
});

test("duplicate normalized surface/layer is rejected but distinct edge, item and layer are allowed", () => {
  assert.throws(() => validateFinishAssignments([{ ...enamel, surfaceLabel: "Ａ" }, { ...enamel, surfaceLabel: " a " }]));
  assert.throws(() => validateFinishAssignments([enamel, { ...enamel, surfaceLabel: "лицевая" }]));
  assert.equal(validateFinishAssignments([enamel, { ...enamel, surfaceKind: "EDGE" },
    { ...enamel, layerOrder: 2 }, { ...enamel, itemId: "part-2" }]).length, 4);
});

test("invalid kinds, fields, layer numbers, HEX and control characters are refused", () => {
  for (const patch of [{ itemId: "" }, { surfaceKind: "UNKNOWN" }, { surfaceLabel: " " },
    { surfaceLabel: "x".repeat(81) }, { finishKind: "UNKNOWN" }, { name: " " }, { code: " " },
    { code: "x".repeat(161) }, { name: "x".repeat(161) }, { layerOrder: 0 }, { layerOrder: 1.5 },
    { layerOrder: 21 }, { layerOrder: NaN }, { colorHex: "#fff" }, { colorHex: "#00zz00" },
    { colorHex: 123 }, { name: "bad\u0000value" }, { name: "bad\n" }, { sampleFileId: 5 },
    { sampleFileId: "https://example.invalid/sample.png" }, { sampleFileId: "/api/files/file-1" },
    { sampleFileId: "file\t1" }, { surfaceKind: "WHOLE", surfaceLabel: 5 }]) {
    assert.throws(() => normalizeFinishAssignment({ ...enamel, ...patch }), JSON.stringify(patch));
  }
  for (const input of [null, undefined, [], 7, "text"]) assert.throws(() => normalizeFinishAssignment(input));
});

test("per-item and per-revision limits reject before accepting an oversized set", () => {
  const row = (itemId: string, index: number) => ({ ...enamel, itemId, surfaceLabel: `Сторона ${Math.floor(index / 20)}`,
    layerOrder: index % 20 + 1 });
  assert.equal(validateFinishAssignments(Array.from({ length: 120 }, (_, i) => row("item-1", i))).length, 120);
  assert.throws(() => validateFinishAssignments(Array.from({ length: 121 }, (_, i) => row("item-1", i))));
  assert.throws(() => validateFinishAssignments(Array.from({ length: 10001 }, (_, i) => row(`item-${i}`, 0))));
  assert.deepEqual(validateFinishAssignments([]), []);
});
