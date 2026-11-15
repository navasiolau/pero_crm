import assert from "node:assert/strict";
import test from "node:test";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import { effectiveProductSpecifications, parseLegacyProductDescription } from "../src/lib/product-legacy-specifications";

test("legacy named and numbered rows retain order, multiline values and literal remnants", () => {
  const raw = "Свободный <b>текст</b>\r\n\r\nКаркас: ЛДСП EGGER H1180 ST37\r\nпродолжение\r\n\r\n2.Фасад МДФ 19 мм\r\n3. Вставки и ручки: GOLA C:26\r\nСвой параметр: АБВ-12345678901234567890";
  const parsed = parseLegacyProductDescription(raw);
  assert.deepEqual(parsed.sections.map(row => [row.label, row.value]), [
    ["", "Свободный <b>текст</b>\r\n\r\n"],
    ["Каркас", "ЛДСП EGGER H1180 ST37\r\nпродолжение\r\n\r\n"],
    ["Фасад", "МДФ 19 мм\r\n"],
    ["Вставки и ручки", "GOLA C:26\r\n"],
    ["Свой параметр", "АБВ-12345678901234567890"],
  ]);
  assert.deepEqual(parseLegacyProductDescription(raw), parsed);
  assert.equal(new Set(parsed.sections.map(row => row.id)).size, parsed.sections.length);
  assert.equal(FurnitureSpecifications.normalizeProduct(parsed) !== null, true);
  assert.equal(parsed.sourceGeneration, 0);
});

test("URLs, times, generic materials and unrecognized numbered text stay literal", () => {
  for (const raw of ["https://example.test/a:b\r\n12:30\r\n", "1. Наружный ЛДСП\n2. Внутренний МДФ", " \r\n\t", "<script>alert('x:y')</script>"]) {
    assert.deepEqual(parseLegacyProductDescription(raw).sections.map(row => [row.label, row.value]), [["", raw]]);
  }
  assert.deepEqual(parseLegacyProductDescription(null).sections, []);
  assert.deepEqual(parseLegacyProductDescription("").sections, []);
});

test("stored JSON including explicit empty sections is authoritative without mutating input", () => {
  const source = { ...FurnitureSpecifications.empty(), sections: [{ id: "custom", type: "custom" as const,
    group: "filling" as const, label: "Моё имя", value: "  Буквально\r\n  " }] };
  const before = structuredClone(source);
  assert.deepEqual(effectiveProductSpecifications(source, "Корпус: Старое")?.sections, source.sections);
  assert.deepEqual(source, before);
  assert.deepEqual(effectiveProductSpecifications(FurnitureSpecifications.empty(), "Корпус: Старое")?.sections, []);
  assert.equal(effectiveProductSpecifications({ sections: [] }, "Корпус: Старое"), null);
  assert.deepEqual(effectiveProductSpecifications(null, "Корпус: Старое"), parseLegacyProductDescription("Корпус: Старое"));
});
