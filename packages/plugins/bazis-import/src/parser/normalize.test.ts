// Тесты нормализации (normalize.ts): кандидаты в изделия и агрегаты
// по 3 эталонным фикстурам.
//
// Эталоны подсчитаны независимо — скриптом на Python (xml.etree.ElementTree):
// прямой обход дерева с теми же правилами кратности, что задокументированы
// в normalize.ts:
// - контейнеры: во всех фикстурах Количество = 1 (проверено отдельно),
//   поэтому эталоны без умножения и с умножением на контейнеры совпадают;
// - м² материала панели: значение XML УЖЕ включает Количество панели
//   (проверено: «полка стекло» ×7 → matQty = площадь × 7) — эталон = сырой Σ;
// - длина кромки: на одну деталь — эталон = Σ Длина × Количество панели
//   (сырой Σ без кратности панели: кухня 369399.0 / прихожая 204368.6 —
//   НЕ используется, физически неверен);
// - кросс-проверка кромки: Σ кромок × кратность совпадает с Σ сопутствующих
//   материалов «кромка…» (кухня: 373.518 м = 373.518 м).

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { buildImportDraft, LOOSE_PRODUCT_TITLE } from "./normalize"
import type { ImportDraft } from "./types"
import { parseBazisXml } from "./xml"

const FIXTURES = {
  shelf: "175.33 Полка Облачко 2шт Детская 2.xml",
  kitchen: "196.1 кухня+остров.xml",
  hallway: "Рома прихожая.xml",
} as const

function draftFixture(name: string): ImportDraft {
  const xml = readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf8")
  return buildImportDraft(parseBazisXml(xml), name)
}

const shelf = draftFixture(FIXTURES.shelf)
const kitchen = draftFixture(FIXTURES.kitchen)
const hallway = draftFixture(FIXTURES.hallway)

describe("buildImportDraft — кандидаты в изделия", () => {
  it("полка: единственный блок → 1 изделие", () => {
    expect(shelf.products).toHaveLength(1)
    const [product] = shelf.products
    expect(product?.kind).toBe("block")
    expect(product?.title).toBe("полка")
    expect(product?.key).toBe("0/0")
    expect(product?.dims).toEqual({ w: 799.59933, h: 380, d: 19 })
    expect(product?.type).toBeUndefined()
  })

  it("кухня: 19 сборок + 3 блока + 1 loose-группа = 23 изделия", () => {
    expect(kitchen.products).toHaveLength(23)
    expect(kitchen.products.filter((p) => p.kind === "assembly")).toHaveLength(19)
    expect(kitchen.products.filter((p) => p.kind === "block")).toHaveLength(3)
    const loose = kitchen.products.filter((p) => p.kind === "loose")
    expect(loose).toHaveLength(1)
    expect(loose[0]?.title).toBe(LOOSE_PRODUCT_TITLE)
    // Свободная панель «Гнутая1» — в loose-группе.
    expect(loose[0]?.techData.panels.map((p) => p.name)).toEqual(["Гнутая1"])
    // Ключи стабильны и уникальны.
    expect(new Set(kitchen.products.map((p) => p.key)).size).toBe(23)
  })

  it("прихожая: 2 блока + 8 сборок = 10 изделий, loose нет", () => {
    expect(hallway.products).toHaveLength(10)
    expect(hallway.products.filter((p) => p.kind === "block")).toHaveLength(2)
    expect(hallway.products.filter((p) => p.kind === "assembly")).toHaveLength(8)
    expect(hallway.products.some((p) => p.kind === "loose")).toBe(false)
  })

  it("сумма панелей по изделиям = сырой счётчик (дерево разбито без потерь)", () => {
    expect(kitchen.products.reduce((sum, p) => sum + p.techData.panels.length, 0)).toBe(256)
    expect(hallway.products.reduce((sum, p) => sum + p.techData.panels.length, 0)).toBe(171)
  })
})

describe("buildImportDraft — агрегаты: материалы панелей (м²)", () => {
  it("panelsM2: кухня 94.7206, прихожая 74.8347, полка 0.3042", () => {
    expect(kitchen.quantities.panelsM2).toBeCloseTo(94.7206, 4)
    expect(hallway.quantities.panelsM2).toBeCloseTo(74.8347, 4)
    expect(shelf.quantities.panelsM2).toBeCloseTo(0.3042, 4)
  })

  it("кухня: группировка по наименованию + толщине", () => {
    const m2 = kitchen.totals.materials.filter((m) => m.unit === "m2")
    const byName = new Map(m2.map((m) => [`${m.name}|${m.thicknessMm ?? ""}`, m.qty]))
    expect(byName.get("U702 ST9 Кашемир серый|18")).toBeCloseTo(22.9714, 4)
    expect(byName.get("U705 ST9 Ангора серая|18")).toBeCloseTo(25.6939, 4)
    expect(byName.get("ХДФ, 3 мм|3")).toBeCloseTo(12.5288, 4)
    expect(byName.get("Кварцевый агломерат 20 мм|20")).toBeCloseTo(6.463, 4)
    expect(m2.reduce((sum, m) => sum + m.qty, 0)).toBeCloseTo(94.7206, 4)
  })

  it("полка: МДФ 19 мм — 0.3042 м²", () => {
    const m2 = shelf.totals.materials.filter((m) => m.unit === "m2")
    expect(m2).toHaveLength(1)
    expect(m2[0]?.name).toBe("МДФ 19 мм")
    expect(m2[0]?.thicknessMm).toBe(19)
    expect(m2[0]?.qty).toBeCloseTo(0.3042, 4)
  })
})

describe("buildImportDraft — агрегаты: кромка", () => {
  it("edgingM (списки 1–4 + по чертежу, × Количество панели): 373.518 / 229.557 / 4.408 м", () => {
    expect(kitchen.quantities.edgingM).toBeCloseTo(373.518, 3)
    expect(hallway.quantities.edgingM).toBeCloseTo(229.557, 3)
    expect(shelf.quantities.edgingM).toBeCloseTo(4.408, 3)
  })

  it("кухня: «кромка в цвет дсп» 1 мм — 341552 мм, «кромка шпон» 0.5 мм — 31966 мм", () => {
    const byName = new Map(kitchen.totals.edging.map((e) => [`${e.name}|${e.thicknessMm}`, e]))
    expect(byName.get("кромка в цвет дсп|1")?.lengthMm).toBeCloseTo(341552, 0)
    expect(byName.get("кромка шпон|0.5")?.lengthMm).toBeCloseTo(31966, 0)
    expect(byName.get("кромка в цвет дсп|1")?.lengthM).toBeCloseTo(341.552, 3)
  })

  it("полка: вся кромка — «по чертежу» (4408.4 мм), списки сторон 1–4 пусты", () => {
    expect(shelf.totals.edging).toHaveLength(1)
    expect(shelf.totals.edging[0]?.name).toBe("кромка в цвет дсп")
    expect(shelf.totals.edging[0]?.lengthMm).toBeCloseTo(4408.4, 1)
    const panel = shelf.products[0]?.techData.panels[0]
    expect(panel?.edges.every((e) => e.side === "drawing")).toBe(true)
  })

  it("сопутствующие материалы НЕ дублируются в edging (отдельная группа materials)", () => {
    // У полки «кромка в цвет дсп» 4.4084 м есть и как сопутствующий материал —
    // в агрегате кромки она учтена ровно один раз (из списков кромок панели).
    const extra = shelf.totals.materials.find((m) => m.name === "кромка в цвет дсп")
    expect(extra?.qty).toBeCloseTo(4.4084, 4)
    expect(shelf.totals.edging[0]?.lengthM).toBeCloseTo(4.408, 3)
  })

  it("кромка без ЕдИзм в XML получает unit «m» (погонные метры, не «шт»)", () => {
    // В фикстуре полки у сопутствующего материала «кромка в цвет дсп» ЕдИзм пустая.
    const extra = shelf.products[0]?.techData.materials.find(
      (m) => m.name === "кромка в цвет дсп",
    )
    expect(extra?.unit).toBe("m")
    expect(extra?.qty).toBeCloseTo(4.4084, 4)
  })
})

describe("buildImportDraft — агрегаты: фурнитура", () => {
  it("конфирматы: кухня 280, прихожая 284 (Σ Количество)", () => {
    const kitchenConfirmat = kitchen.totals.fittings.find((f) => f.name === "Конфирмат")
    expect(kitchenConfirmat?.qty).toBe(280)
    const hallwayConfirmat = hallway.totals.fittings.find((f) => f.name === "Конфирмат")
    expect(hallwayConfirmat?.qty).toBe(284)
  })

  it("суммарно простой фурнитуры: кухня 640 шт, прихожая 583 шт", () => {
    const sum = (draft: ImportDraft): number =>
      draft.totals.fittings
        .filter((f) => f.objectType === "Фурнитура")
        .reduce((acc, f) => acc + f.qty, 0)
    expect(sum(kitchen)).toBe(640)
    expect(sum(hallway)).toBe(583)
    expect(sum(shelf)).toBe(0)
  })

  it("группировка: повторяющиеся позиции схлопнуты, пути сохранены", () => {
    const confirmat = kitchen.totals.fittings.find((f) => f.name === "Конфирмат")
    expect(confirmat).toBeDefined()
    expect(confirmat?.parentPaths.length).toBeGreaterThan(0)
    // Пути содержат имена контейнеров (модулей кухни).
    expect(confirmat?.parentPaths.some((p) => p.includes("модуль"))).toBe(true)
  })
})

describe("buildImportDraft — профили и количества для шаблонов", () => {
  it("профили: элементы и погонаж", () => {
    expect(kitchen.totals.profiles.reduce((sum, p) => sum + p.qty, 0)).toBe(49)
    expect(hallway.totals.profiles.reduce((sum, p) => sum + p.qty, 0)).toBe(25)
    expect(shelf.totals.profiles).toHaveLength(0)
  })

  it("panelsCount / boxesCount", () => {
    // Σ эффективных количеств панелей (у части панелей Количество > 1).
    expect(kitchen.quantities.panelsCount).toBe(265)
    expect(hallway.quantities.panelsCount).toBe(189)
    expect(shelf.quantities.panelsCount).toBe(1)
    // «Ящики»: контейнеры с именем «ящик…» / «короб ящика».
    expect(kitchen.quantities.boxesCount).toBe(21)
    expect(hallway.quantities.boxesCount).toBe(2)
    expect(shelf.quantities.boxesCount).toBe(0)
  })
})

describe("buildImportDraft — techData изделия", () => {
  it("полка: панель с материалом, кромками и пользовательскими свойствами", () => {
    const tech = shelf.products[0]?.techData
    expect(tech?.panels).toHaveLength(1)
    const panel = tech?.panels[0]
    expect(panel?.name).toBe("облако")
    expect(panel?.qty).toBe(1)
    expect(panel?.material?.name).toBe("МДФ 19 мм")
    expect(panel?.material?.areaM2).toBeCloseTo(0.3042, 4)
    expect(panel?.edges).toHaveLength(16)
    expect(panel?.parentPath).toEqual(["полка"])
    expect(panel?.userProperties).toEqual({ цвет: "RAL 9003" })
  })

  it("кухня: эффективное количество панели учитывает Количество из XML", () => {
    // «полка стекло» встречается с Количество=7.
    const all = kitchen.products.flatMap((p) => p.techData.panels)
    const glassShelf = all.find((p) => p.name === "полка стекло" && p.qty === 7)
    expect(glassShelf).toBeDefined()
    // м² в techData = значение XML (уже ×7), без повторного умножения.
    expect(glassShelf?.material?.areaM2).toBeCloseTo(0.8992, 4)
  })
})

describe("buildImportDraft — source", () => {
  it("заполняет fileName, format, projectName, version", () => {
    expect(shelf.source).toEqual({
      fileName: FIXTURES.shelf,
      format: "bazis-xml",
      projectName: "175.33",
      version: "10.6.2.25670",
    })
  })

  it("fileName необязателен", () => {
    const xml = readFileSync(
      fileURLToPath(new URL(`../../fixtures/${FIXTURES.shelf}`, import.meta.url)),
      "utf8",
    )
    const draft = buildImportDraft(parseBazisXml(xml))
    expect(draft.source.fileName).toBeUndefined()
    expect(draft.source.format).toBe("bazis-xml")
  })
})
