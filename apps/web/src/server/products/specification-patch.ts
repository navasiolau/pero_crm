import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import type { ProductPatch, ProductSpecificationRowValue } from "./patch-contract";

export type SpecificationPatch = Extract<ProductPatch, { field: "technicalSpecificationRow" }>;

export function isSpecificationPatch(patch: ProductPatch): patch is SpecificationPatch {
  return patch.field === "technicalSpecificationRow";
}

type SpecificationChange = {
  ok: true;
  value: ProductSpecificationRowValue | null;
  sectionId: string;
  next: TechnicalSpecifications;
  noOp: boolean;
} | { ok: false; error: string; currentValue?: ProductSpecificationRowValue | null };

const pair = (section: FurnitureSection | undefined): ProductSpecificationRowValue | null =>
  section ? { label: section.label, value: section.value } : null;
const samePair = (left: ProductSpecificationRowValue | null, right: ProductSpecificationRowValue | null) =>
  left === null || right === null ? left === right : left.label === right.label && left.value === right.value;

/** Пара сравнивается со свежим JSON под блокировкой изделия; удалённый ID не добавляется поздней правкой. */
export function applySpecificationPatch(before: TechnicalSpecifications | null, patch: SpecificationPatch): SpecificationChange {
  const next = before ?? FurnitureSpecifications.empty();
  const current = next.sections.find(section => section.id === patch.sectionId);
  const previous = pair(current);
  if (!samePair(previous, patch.expectedRow))
    return { ok: false, error: "Строка изменена или удалена. Обновите карточку изделия", currentValue: previous };
  const value = patch.row && (patch.row.label.trim() || patch.row.value.trim()) ? patch.row : null;
  if (samePair(previous, value))
    return { ok: true, value: previous, sectionId: patch.sectionId, next, noOp: true };

  const editRevision = (next.editRevision ?? 0) + 1;
  if (!Number.isSafeInteger(editRevision))
    return { ok: false, error: "Исчерпан номер изменения технического описания" };
  if (value === null) {
    return { ok: true, value: null, sectionId: patch.sectionId, noOp: false,
      next: { ...next, editRevision, sections: next.sections.filter(section => section.id !== patch.sectionId) } };
  }
  const updated: FurnitureSection = current ? { ...current, ...value } : {
    id: patch.sectionId, type: "custom", group: "construction", ...value,
  };
  return { ok: true, value, sectionId: patch.sectionId, noOp: false,
    next: { ...next, editRevision, sections: current ? next.sections.map(section => section.id === patch.sectionId ? updated : section) : [...next.sections, updated] } };
}
