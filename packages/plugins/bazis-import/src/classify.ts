// Классификатор типов изделий (этап B): правила из настроек плагина
// применяются к имени изделия и признакам из деталировки (имена фурнитуры,
// материалов, панелей). Первое совпавшее правило побеждает; не распознан —
// тип universal (помечается matched=false, на экране подтверждения подсветка).

import type { DraftProduct, ImportDraft, TechData } from "./parser/types"
import type { ClassifierRule } from "./settings"
import { UNIVERSAL_LABEL, UNIVERSAL_TYPE } from "./settings"

export interface ClassifyResult {
  type: string
  label: string
  /** false — ни одно правило не совпало, тип подставлен по умолчанию. */
  matched: boolean
}

/** Признаки изделия: имена фурнитуры, материалов и панелей, lowercase, одной строкой. */
function productFeatures(techData: TechData): string {
  return [
    ...techData.fittings.map((fitting) => fitting.name),
    ...techData.materials.map((material) => material.name),
    ...techData.panels.map((panel) => panel.name),
  ]
    .join("\n")
    .toLowerCase()
}

/**
 * Классификация одного изделия. Правило матчится, если ХОТЯ БЫ одна подстрока
 * из any встречается в имени ИЛИ в признаках, и НИ одна из none не встречается
 * в имени (none — только по имени, чтобы «фасад» в составе кухни не ломал
 * правило «модуль»).
 */
export function classifyProduct(
  product: { title: string; techData: TechData },
  rules: ClassifierRule[],
): ClassifyResult {
  const name = product.title.toLowerCase()
  const features = productFeatures(product.techData)
  for (const rule of rules) {
    const excluded = (rule.none ?? []).some((needle) =>
      name.includes(needle.toLowerCase()),
    )
    if (excluded) continue
    const matched = rule.any.some((needle) => {
      const lowered = needle.toLowerCase()
      return name.includes(lowered) || features.includes(lowered)
    })
    if (matched) return { type: rule.type, label: rule.label, matched: true }
  }
  return { type: UNIVERSAL_TYPE, label: UNIVERSAL_LABEL, matched: false }
}

/**
 * Проставляет type каждому изделию драфта. Изделия, где type уже задан
 * (ручная правка на экране подтверждения + повторный preview), не трогает.
 */
export function classifyDraft(draft: ImportDraft, rules: ClassifierRule[]): ImportDraft {
  return {
    ...draft,
    products: draft.products.map((product) => {
      if (product.type !== undefined) return product
      const result = classifyProduct(product, rules)
      return { ...product, type: result.type, typeMatched: result.matched }
    }),
  }
}
