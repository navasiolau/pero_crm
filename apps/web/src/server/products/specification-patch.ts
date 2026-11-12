import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { TechnicalSpecifications } from "@pero/kp-template";
import type { ProductPatch } from "./patch-contract";

export type SpecificationPatch = Extract<ProductPatch, { field: "technicalSpecificationEntry" }>;

export function isSpecificationPatch(patch: ProductPatch): patch is SpecificationPatch {
  return patch.field === "technicalSpecificationEntry";
}

type SpecificationChange = {
  ok: true;
  value: string;
  sectionId: string | null;
  next: TechnicalSpecifications;
  noOp: boolean;
} | { ok: false; error: string; currentValue?: string };

/** Каждый запрос сравнивается со свежим JSON под блокировкой изделия. */
export function applySpecificationPatch(before: TechnicalSpecifications | null, patch: SpecificationPatch): SpecificationChange {
  const next = FurnitureSpecifications.forProduct(before);
  const row = next.sections.find(section => section.type === patch.type);
  if ((row?.id ?? null) !== patch.expectedSectionId)
    return { ok: false, error: "Характеристики изменены. Обновите карточку изделия" };
  const previous = row?.value ?? "";
  if (previous !== patch.expectedValue)
    return { ok: false, error: "Поле изменено другим пользователем", currentValue: previous };
  if (previous === patch.value)
    return { ok: true, value: previous, sectionId: row?.id ?? null, next, noOp: true };

  if (!row && next.sections.some(section => section.id === patch.clientMutationId))
    return { ok: false, error: "Идентификатор строки уже используется. Повторите ввод после обновления карточки" };
  const standard = FurnitureSpecifications.CATALOG.find(section => section.type === patch.type)!;
  const updated = { id: row?.id ?? patch.clientMutationId, ...standard, value: patch.value };
  const sections = row ? next.sections.map(section => section.type === patch.type ? updated : section) : [...next.sections, updated];
  return {
    ok: true, value: patch.value, sectionId: updated.id, noOp: false,
    next: { ...next, sections: FurnitureSpecifications.orderedSections(sections) },
  };
}
