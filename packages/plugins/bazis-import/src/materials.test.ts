// Тесты этапа C: сбор потребности из techData, перевод единиц,
// разрешение маппинга и сводка несмапленных.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  collectProductNeeds,
  resolveNeeds,
  summarizeUnmapped,
  unitFromBazis,
} from "./materials"
import { buildImportDraft } from "./parser/normalize"
import type { TechData } from "./parser/types"
import { parseBazisXml } from "./parser/xml"
import type { MaterialMapEntry } from "./settings"

function shelfTechData(): TechData {
  const xml = readFileSync(
    fileURLToPath(
      new URL("../fixtures/175.33 Полка Облачко 2шт Детская 2.xml", import.meta.url),
    ),
    "utf8",
  )
  const draft = buildImportDraft(parseBazisXml(xml), "shelf")
  const product = draft.products[0]
  if (!product) throw new Error("в фикстуре полки нет изделий")
  return product.techData
}

describe("unitFromBazis", () => {
  it("переводит базисные и XML-единицы в складские", () => {
    expect(unitFromBazis("m2")).toBe("м²")
    expect(unitFromBazis("m")).toBe("м.п.")
    expect(unitFromBazis("")).toBe("шт")
    expect(unitFromBazis("шт")).toBe("шт")
    expect(unitFromBazis("кг")).toBe("кг")
    expect(unitFromBazis("пар")).toBe("шт") // незнакомая ЕдИзм → шт
  })
})

describe("collectProductNeeds", () => {
  it("полка: МДФ м² + кромка м.п. (сопутствующая «кромка…» не дублируется)", () => {
    const needs = collectProductNeeds(shelfTechData())
    expect(needs).toHaveLength(2)
    expect(needs).toContainEqual({
      bazisName: "МДФ 19 мм",
      bazisCode: "МДФ 19",
      unit: "м²",
      qty: 0.3042,
      source: "material",
    })
    expect(needs).toContainEqual({
      bazisName: "кромка в цвет дсп",
      unit: "м.п.",
      qty: 4.408,
      source: "edging",
    })
  })

  it("группирует дубли по (имя+код+единица) с суммированием", () => {
    const techData: TechData = {
      panels: [],
      profiles: [],
      edging: [],
      materials: [
        { name: "Клей", code: "", unit: "кг", qty: 0.5 },
        { name: "Клей", code: "", unit: "кг", qty: 0.25 },
      ],
      fittings: [
        { name: "Петля", code: "P1", objectType: "Фурнитура", qty: 2, parentPaths: [] },
        { name: "Петля", code: "P1", objectType: "Фурнитура", qty: 2, parentPaths: [] },
      ],
    }
    const needs = collectProductNeeds(techData)
    expect(needs).toHaveLength(2)
    expect(needs).toContainEqual({
      bazisName: "Клей",
      unit: "кг",
      qty: 0.75,
      source: "material",
    })
    expect(needs).toContainEqual({
      bazisName: "Петля",
      bazisCode: "P1",
      unit: "шт",
      qty: 4,
      source: "fitting",
    })
  })

  it("профили — погонажом (lengthMm × qty), м.п.", () => {
    const techData: TechData = {
      panels: [],
      edging: [],
      fittings: [],
      materials: [],
      profiles: [
        { name: "Профиль ручка", code: "PR", lengthMm: 500, qty: 2 },
        { name: "Профиль ручка", code: "PR", lengthMm: 300, qty: 1 },
      ],
    }
    const needs = collectProductNeeds(techData)
    expect(needs).toEqual([
      {
        bazisName: "Профиль ручка",
        bazisCode: "PR",
        unit: "м.п.",
        qty: 1.3,
        source: "profile",
      },
    ])
  })
})

describe("resolveNeeds", () => {
  const materials = [
    { id: "mat-mdf", name: "МДФ 19 мм (склад)" },
    { id: "mat-edge", name: "Кромка ПВХ" },
  ]
  const needs = collectProductNeeds(shelfTechData())

  it("резолвит по имени без кода, регистронезависимо и с пробелами", () => {
    const map: MaterialMapEntry[] = [
      { bazisName: "  мдф 19 ММ", materialId: "mat-mdf" },
      { bazisName: "Кромка В Цвет Дсп", materialId: "mat-edge" },
    ]
    const resolved = resolveNeeds(needs, map, materials)
    expect(resolved[0]).toMatchObject({ materialId: "mat-mdf", materialName: "МДФ 19 мм (склад)" })
    expect(resolved[1]).toMatchObject({ materialId: "mat-edge", materialName: "Кромка ПВХ" })
  })

  it("запись с кодом матчится только при равенстве кода", () => {
    const map: MaterialMapEntry[] = [
      { bazisName: "МДФ 19 мм", bazisCode: "ДРУГОЙ", materialId: "mat-edge" },
    ]
    const resolved = resolveNeeds(needs, map, materials)
    expect(resolved[0]?.materialId).toBeUndefined()
  })

  it("приоритет записи с заполненным кодом над общей", () => {
    const map: MaterialMapEntry[] = [
      // Общая запись стоит первой, но проигрывает кодовой.
      { bazisName: "МДФ 19 мм", materialId: "mat-edge" },
      { bazisName: "МДФ 19 мм", bazisCode: "МДФ 19", materialId: "mat-mdf" },
    ]
    const resolved = resolveNeeds(needs, map, materials)
    expect(resolved[0]).toMatchObject({ materialId: "mat-mdf" })
  })

  it("materialId вне номенклатуры → несмаплено + orphanMaterialId", () => {
    const map: MaterialMapEntry[] = [{ bazisName: "МДФ 19 мм", materialId: "mat-ghost" }]
    const resolved = resolveNeeds(needs, map, materials)
    expect(resolved[0]?.materialId).toBeUndefined()
    expect(resolved[0]?.orphanMaterialId).toBe("mat-ghost")
  })
})

describe("summarizeUnmapped", () => {
  it("группирует несмапленные по позициям, samples ≤ 2", () => {
    const summary = summarizeUnmapped([
      {
        title: "Полка",
        materials: [
          { bazisName: "МДФ 19 мм", unit: "м²", qty: 1, source: "material" },
          { bazisName: "Клей", unit: "кг", qty: 1, source: "material", materialId: "m1" },
        ],
      },
      {
        title: "Шкаф",
        materials: [{ bazisName: "мдф 19 ММ", unit: "м²", qty: 2, source: "material" }],
      },
      {
        title: "Стол",
        materials: [{ bazisName: "МДФ 19 мм", unit: "м²", qty: 3, source: "material" }],
      },
    ])
    expect(summary).toEqual([
      { bazisName: "МДФ 19 мм", unit: "м²", samples: ["Полка", "Шкаф"] },
    ])
  })
})
