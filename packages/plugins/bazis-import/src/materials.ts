// Потребность в материалах склада (этап C): сбор из деталировки изделия
// (collectProductNeeds), разрешение маппинга Базис→номенклатура (resolveNeeds)
// и сводка несмапленных позиций по драфту (summarizeUnmapped).
//
// Кромка учитывается ТОЛЬКО из агрегата edging: сопутствующий материал
// «кромка…» (ед. "m") дублирует этот расход (проверено фикстурами, см.
// normalize.ts), поэтому из materials пропускается.

import type { MaterialNeed, ResolvedNeed, TechData } from "./parser/types"
import type { MaterialMapEntry } from "./settings"

export type { MaterialNeed, ResolvedNeed } from "./parser/types"

/**
 * Единицы склада. Осознанное дублирование MATERIAL_UNITS из
 * apps/web/src/lib/labels.ts — пакет самодостаточен (хост не импортируется).
 */
export const MATERIAL_UNITS = ["шт", "м²", "м.п.", "лист", "кг", "м", "компл", "упак"] as const

/** Единица Базиса → складская: "m2"→"м²", "m"→"м.п.", знакомая ЕдИзм — как есть, иначе "шт". */
export function unitFromBazis(unit: string): string {
  const trimmed = unit.trim()
  if (trimmed === "m2") return "м²"
  if (trimmed === "m") return "м.п."
  if (trimmed === "") return "шт"
  return (MATERIAL_UNITS as readonly string[]).includes(trimmed) ? trimmed : "шт"
}

const round4 = (value: number) => Math.round(value * 10000) / 10000
const round3 = (value: number) => Math.round(value * 1000) / 1000

const norm = (value: string) => value.trim().toLowerCase()

/**
 * Потребности одного изделия из его деталировки:
 * - materials — как есть (кроме сопутствующей «кромка…» — она в edging);
 * - edging — имя кромки, ед. "м.п.", кол-во = lengthM;
 * - fittings — ед. "шт";
 * - profiles — погонаж (Σ lengthMm × qty / 1000), ед. "м.п.".
 * Дубли внутри изделия схлопываются по (имя+код+единица) с суммированием.
 */
export function collectProductNeeds(techData: TechData): MaterialNeed[] {
  const raw: MaterialNeed[] = []

  for (const material of techData.materials) {
    // Сопутствующая «кромка…» (ед. "m") дублирует агрегат edging — пропускаем.
    if (material.unit === "m" && norm(material.name).startsWith("кромка")) continue
    raw.push({
      bazisName: material.name,
      ...(material.code.trim() !== "" ? { bazisCode: material.code } : {}),
      unit: unitFromBazis(material.unit),
      qty: material.qty,
      source: "material",
    })
  }
  for (const edge of techData.edging) {
    raw.push({ bazisName: edge.name, unit: "м.п.", qty: edge.lengthM, source: "edging" })
  }
  for (const fitting of techData.fittings) {
    raw.push({
      bazisName: fitting.name,
      ...(fitting.code.trim() !== "" ? { bazisCode: fitting.code } : {}),
      unit: "шт",
      qty: fitting.qty,
      source: "fitting",
    })
  }
  // Профили: сначала погонаж по (имя+код), потом общая группировка.
  const profileMm = new Map<string, { name: string; code: string; mm: number }>()
  for (const profile of techData.profiles) {
    const key = `${profile.name} ${profile.code}`
    const existing = profileMm.get(key)
    if (existing) {
      existing.mm += profile.lengthMm * profile.qty
    } else {
      profileMm.set(key, {
        name: profile.name,
        code: profile.code,
        mm: profile.lengthMm * profile.qty,
      })
    }
  }
  for (const profile of profileMm.values()) {
    raw.push({
      bazisName: profile.name,
      ...(profile.code.trim() !== "" ? { bazisCode: profile.code } : {}),
      unit: "м.п.",
      qty: round3(profile.mm / 1000),
      source: "profile",
    })
  }

  const grouped = new Map<string, MaterialNeed>()
  for (const need of raw) {
    const key = `${norm(need.bazisName)} ${need.bazisCode ?? ""} ${need.unit}`
    const existing = grouped.get(key)
    if (existing) {
      existing.qty = round4(existing.qty + need.qty)
    } else {
      grouped.set(key, { ...need, qty: round4(need.qty) })
    }
  }
  return [...grouped.values()].filter((need) => need.qty > 0)
}

/**
 * Разрешение маппинга: запись совпадает, если bazisName равен (trim,
 * регистронезависимо) И (bazisCode записи пуст ИЛИ равен коду потребности).
 * Приоритет — записи с заполненным кодом (внутри — порядок в materialMap).
 * materialId, которого нет в списке materials, считается несмапленным
 * (возвращается orphanMaterialId для диагностики).
 */
export function resolveNeeds(
  needs: MaterialNeed[],
  materialMap: MaterialMapEntry[],
  materials: { id: string; name: string }[],
): ResolvedNeed[] {
  const byId = new Map(materials.map((material) => [material.id, material]))
  // Записи с заполненным кодом проверяются первыми, порядок внутри групп — исходный.
  const entries = materialMap
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aCoded = a.entry.bazisCode?.trim() ? 0 : 1
      const bCoded = b.entry.bazisCode?.trim() ? 0 : 1
      return aCoded - bCoded || a.index - b.index
    })

  return needs.map((need) => {
    const match = entries.find(
      ({ entry }) =>
        norm(entry.bazisName) === norm(need.bazisName) &&
        (!entry.bazisCode?.trim() ||
          entry.bazisCode.trim() === (need.bazisCode ?? "").trim()),
    )
    if (!match) return { ...need }
    const material = byId.get(match.entry.materialId)
    if (!material) return { ...need, orphanMaterialId: match.entry.materialId }
    return { ...need, materialId: material.id, materialName: material.name }
  })
}

/** Несмапленная позиция по всему драфту (для блока «Материалы и склад»). */
export interface UnmappedMaterialSummary {
  bazisName: string
  bazisCode?: string
  unit: string
  /** 1–2 названия изделий, где позиция встречается. */
  samples: string[]
}

/** Сводка несмапленных позиций по изделиям драфта (без дублей, samples ≤ 2). */
export function summarizeUnmapped(
  products: { title: string; materials?: ResolvedNeed[] }[],
): UnmappedMaterialSummary[] {
  const map = new Map<string, UnmappedMaterialSummary>()
  for (const product of products) {
    for (const need of product.materials ?? []) {
      if (need.materialId) continue
      const key = `${norm(need.bazisName)} ${need.bazisCode ?? ""} ${need.unit}`
      const existing = map.get(key)
      if (existing) {
        if (existing.samples.length < 2 && !existing.samples.includes(product.title)) {
          existing.samples.push(product.title)
        }
      } else {
        map.set(key, {
          bazisName: need.bazisName,
          ...(need.bazisCode !== undefined ? { bazisCode: need.bazisCode } : {}),
          unit: need.unit,
          samples: [product.title],
        })
      }
    }
  }
  return [...map.values()]
}
