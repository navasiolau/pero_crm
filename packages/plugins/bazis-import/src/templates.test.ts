// Тесты движка шаблонов: DAG-валидация, топологический порядок, количества
// по qtyRule, разворачивание шаблона в работы/задачи с прайсом.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { buildImportDraft, parseBazisXml } from "./parser"
import type { ProductTemplate, TemplateTask } from "./settings"
import {
  computeWorkQty,
  expandTemplate,
  productQuantities,
  resolveTemplate,
  topoOrder,
  validateDag,
  type PriceItemInfo,
} from "./templates"
import { DEFAULT_SETTINGS } from "./settings"

const task = (title: string, dependsOn: number[] = []): TemplateTask => ({
  title,
  estimateMinutes: 30,
  dependsOn,
})

describe("validateDag", () => {
  it("принимает цепочку и ромб", () => {
    expect(validateDag([task("a"), task("b", [0]), task("c", [1])])).toBeNull()
    // Ромб: 0 → 1,2 → 3.
    expect(validateDag([task("a"), task("b", [0]), task("c", [0]), task("d", [1, 2])])).toBeNull()
  })

  it("отклоняет цикл", () => {
    expect(validateDag([task("a", [1]), task("b", [0])])).toBe("Цикл в зависимостях задач шаблона")
  })

  it("отклоняет самоссылку", () => {
    expect(validateDag([task("a", [0])])).toContain("зависит сама от себя")
  })

  it("отклоняет индекс вне диапазона", () => {
    expect(validateDag([task("a", [5])])).toContain("вне списка задач")
    expect(validateDag([task("a", [-1])])).toContain("вне списка задач")
  })
})

describe("topoOrder", () => {
  it("предшественники раньше потомков, при равенстве — по индексу", () => {
    expect(topoOrder([task("a"), task("b", [0]), task("c", [0]), task("d", [1, 2])])).toEqual([
      0, 1, 2, 3,
    ])
    // Обратная цепочка: последняя независима.
    expect(topoOrder([task("a", [1]), task("b", [2]), task("c")])).toEqual([2, 1, 0])
  })
})

describe("computeWorkQty", () => {
  const q = { panelsM2: 10.5, edgingM: 4.408, boxesCount: 3, panelsCount: 12 }

  it("fixed → factor (по умолчанию 1)", () => {
    expect(computeWorkQty("fixed", undefined, q)).toBe(1)
    expect(computeWorkQty("fixed", 2.5, q)).toBe(2.5)
  })

  it("агрегаты × factor, округление до 2 знаков", () => {
    expect(computeWorkQty("panels_m2", undefined, q)).toBe(10.5)
    expect(computeWorkQty("panels_m2", 2, q)).toBe(21)
    expect(computeWorkQty("edging_m", 1.5, q)).toBe(6.61)
    expect(computeWorkQty("boxes_count", undefined, q)).toBe(3)
    expect(computeWorkQty("panels_count", 0.5, q)).toBe(6)
  })
})

describe("productQuantities (фикстура полки)", () => {
  const draft = buildImportDraft(
    parseBazisXml(readFileSync("fixtures/175.33 Полка Облачко 2шт Детская 2.xml", "utf8")),
  )
  const shelf = draft.products[0]

  it("совпадает с агрегатами драфта и с DraftProduct.quantities из normalize", () => {
    if (!shelf) throw new Error("нет изделия в фикстуре")
    const q = productQuantities(shelf.techData)
    expect(q.panelsM2).toBe(0.3042)
    expect(q.edgingM).toBe(4.408)
    expect(q.boxesCount).toBe(0)
    expect(q.panelsCount).toBe(1)
    // normalize проставляет те же значения в DraftProduct.quantities.
    expect(shelf.quantities).toEqual(q)
    expect(draft.quantities).toEqual(q)
  })

  it("кухня: normalize проставляет количества каждому изделию", () => {
    const kitchen = buildImportDraft(
      parseBazisXml(readFileSync("fixtures/196.1 кухня+остров.xml", "utf8")),
    )
    for (const product of kitchen.products) {
      expect(product.quantities).toBeDefined()
      // Панели/площадь/кромка точно восстанавливаются из techData…
      expect(productQuantities(product.techData).panelsM2).toBe(product.quantities?.panelsM2)
      expect(productQuantities(product.techData).edgingM).toBe(product.quantities?.edgingM)
      expect(productQuantities(product.techData).panelsCount).toBe(product.quantities?.panelsCount)
    }
    // …а boxesCount из techData — приближение (одноимённые ящики под одним
    // путём слипаются), поэтому движок предпочитает product.quantities.
    const withBoxes = kitchen.products.find((p) => (p.quantities?.boxesCount ?? 0) > 0)
    expect(withBoxes).toBeDefined()
    const template: ProductTemplate = {
      type: "t",
      label: "t",
      works: [{ priceItemId: "p-boxes", qtyRule: "boxes_count" }],
      tasks: [],
    }
    const priceItems = new Map<string, PriceItemInfo>([
      ["p-boxes", { name: "Сборка ящика", unit: "шт", price: 500, active: true }],
    ])
    const result = expandTemplate(template, withBoxes!, { priceItems })
    expect(result.works[0]?.quantity).toBe(withBoxes!.quantities!.boxesCount)
  })
})

describe("resolveTemplate", () => {
  it("по типу → universal → пустой шаблон", () => {
    expect(resolveTemplate("shkaf", DEFAULT_SETTINGS).type).toBe("shkaf")
    expect(resolveTemplate("неизвестный", DEFAULT_SETTINGS).type).toBe("universal")
    expect(
      resolveTemplate("shkaf", { classifierRules: [], productTemplates: [], materialMap: [] }),
    ).toEqual({ type: "universal", label: "Универсальный", works: [], tasks: [] })
  })
})

describe("expandTemplate", () => {
  const draft = buildImportDraft(
    parseBazisXml(readFileSync("fixtures/175.33 Полка Облачко 2шт Детская 2.xml", "utf8")),
  )
  const shelf = draft.products[0]
  if (!shelf) throw new Error("нет изделия в фикстуре")

  const priceItems = new Map<string, PriceItemInfo>([
    ["p-cutting", { name: "Раскрой ЛДСП", unit: "м²", price: "150.5", active: true }],
    ["p-edging", { name: "Кромка", unit: "м.п.", price: 25, active: true }],
    ["p-setup", { name: "Присадка", unit: "компл", price: 300, active: true }],
    ["p-inactive", { name: "Старая расценка", unit: "шт", price: 10, active: false }],
    ["p-boxes", { name: "Сборка ящика", unit: "шт", price: 500, active: true }],
  ])

  const template: ProductTemplate = {
    type: "universal",
    label: "Универсальный",
    works: [
      { priceItemId: "p-cutting", qtyRule: "panels_m2" },
      { priceItemId: "p-edging", qtyRule: "edging_m", factor: 2 },
      { priceItemId: "p-setup", qtyRule: "fixed", factor: 1 },
      { priceItemId: "p-missing", qtyRule: "panels_m2" },
      { priceItemId: "p-inactive", qtyRule: "panels_m2" },
      { priceItemId: "p-boxes", qtyRule: "boxes_count" }, // у полки ящиков нет → qty 0
    ],
    tasks: [task("Раскрой"), task("Сборка", [0])],
  }

  it("работы со снимком цены, сумма = цена × количество; проблемные пропускаются", () => {
    const result = expandTemplate(template, shelf, { priceItems })

    expect(result.works).toHaveLength(3)
    expect(result.works[0]).toEqual({
      priceItemId: "p-cutting",
      title: "Раскрой ЛДСП",
      unit: "м²",
      quantity: 0.3, // panelsM2 0.3042, округление количества до 2 знаков
      price: 150.5,
      total: 45.15, // 150.5 × 0.3
    })
    expect(result.works[1]?.quantity).toBe(8.82) // 4.408 × 2
    expect(result.works[1]?.total).toBe(220.5)
    expect(result.works[2]).toMatchObject({ quantity: 1, price: 300, total: 300 })

    expect(result.problems).toHaveLength(3)
    expect(result.problems[0]).toContain("расценка не найдена")
    expect(result.problems[1]).toContain("неактивна")
    expect(result.problems[2]).toContain("нулевое количество")

    expect(result.tasks).toEqual([
      { title: "Раскрой", estimateMinutes: 30, dependsOn: [] },
      { title: "Сборка", estimateMinutes: 30, dependsOn: [0] },
    ])
  })

  it("работает и по techData без DraftProduct.quantities (старый драфт)", () => {
    const legacyProduct = { ...shelf }
    delete legacyProduct.quantities
    const result = expandTemplate(template, legacyProduct, { priceItems })
    expect(result.works[0]?.quantity).toBe(0.3)
  })

  it("шаблон без работ → только задачи, без проблем", () => {
    const result = expandTemplate(
      { type: "universal", label: "Универсальный", works: [], tasks: [task("Контроль")] },
      shelf,
      { priceItems },
    )
    expect(result.works).toEqual([])
    expect(result.problems).toEqual([])
    expect(result.tasks).toHaveLength(1)
  })
})
