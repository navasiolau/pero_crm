import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import type { ProductPatch, ProductPatchValue } from "./patch-contract";

export type SpecificationPatch = Extract<ProductPatch, {
  field: "technicalSpecificationValue" | "technicalSpecificationSource" |
    "technicalSpecificationAdd" | "technicalSpecificationRemove";
}>;

export function isSpecificationPatch(patch: ProductPatch): patch is SpecificationPatch {
  return patch.field === "technicalSpecificationValue" || patch.field === "technicalSpecificationSource" ||
    patch.field === "technicalSpecificationAdd" || patch.field === "technicalSpecificationRemove";
}

function sameSection(left: FurnitureSection, right: FurnitureSection): boolean {
  return left.id === right.id && left.type === right.type && left.group === right.group &&
    left.label === right.label && left.value === right.value;
}

type SpecificationChange = {
  ok: true;
  value: ProductPatchValue;
  next: TechnicalSpecifications;
  noOp: boolean;
} | { ok: false; error: string; currentValue?: ProductPatchValue };

/** Вызывается со свежим JSON после блокировки изделия. */
export function applySpecificationPatch(before: TechnicalSpecifications | null, patch: SpecificationPatch): SpecificationChange {
  const next = before ?? FurnitureSpecifications.empty();
  if (patch.field === "technicalSpecificationSource") {
    const previous = next[patch.source];
    if (previous !== patch.expectedValue) return { ok: false, error: "Поле изменено другим пользователем", currentValue: previous };
    return { ok: true, value: patch.value, next: { ...next, [patch.source]: patch.value }, noOp: previous === patch.value };
  }

  const sectionId = patch.field === "technicalSpecificationValue" ? patch.sectionId : patch.section.id;
  const row = next.sections.find(section => section.id === sectionId);
  if (patch.field === "technicalSpecificationAdd") {
    if (row && !sameSection(row, patch.section)) return { ok: false, error: "Раздел уже добавлен с другими данными" };
    if (!row && patch.section.type !== "custom" && next.sections.some(section => section.type === patch.section.type))
      return { ok: false, error: "Раздел этого типа уже добавлен" };
    return { ok: true, value: null, next: row ? next : { ...next, sections: [...next.sections, patch.section] }, noOp: Boolean(row) };
  }
  if (patch.field === "technicalSpecificationRemove") {
    if (row && !sameSection(row, patch.section)) return { ok: false, error: "Раздел изменён другим пользователем" };
    return { ok: true, value: null, next: { ...next, sections: next.sections.filter(section => section.id !== sectionId) }, noOp: !row };
  }

  if (!row) return { ok: false, error: "Раздел удалён или заменён другим пользователем" };
  if (row.value !== patch.expectedValue) return { ok: false, error: "Раздел изменён другим пользователем", currentValue: row.value };
  return {
    ok: true, value: patch.value, noOp: row.value === patch.value,
    next: { ...next, sections: next.sections.map(section => section.id === sectionId ? { ...section, value: patch.value } : section) },
  };
}
