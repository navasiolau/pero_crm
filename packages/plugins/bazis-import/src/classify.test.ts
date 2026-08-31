// Тесты классификатора на эталонных фикстурах: типы изделий кухни, прихожей
// и полки по DEFAULT_SETTINGS.classifierRules + кастомные none/feature-правила.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { classifyDraft, classifyProduct } from "./classify"
import { buildImportDraft, parseBazisXml } from "./parser"
import type { TechData } from "./parser"
import { DEFAULT_SETTINGS, type ClassifierRule } from "./settings"

const RULES = DEFAULT_SETTINGS.classifierRules

function loadDraft(fileName: string) {
  const xml = readFileSync(`fixtures/${fileName}`, "utf8")
  return buildImportDraft(parseBazisXml(xml), fileName)
}

const emptyTechData = (): TechData => ({
  panels: [],
  profiles: [],
  fittings: [],
  materials: [],
  edging: [],
})

describe("classifyProduct", () => {
  it("матчит по подстроке имени, первое правило побеждает", () => {
    // «модуль» идёт в правилах раньше «фасад» → kitchen_module, несмотря на «два фасада».
    const result = classifyProduct(
      { title: "модуль сушка INOX L=500-1000 (два фасада)", techData: emptyTechData() },
      RULES,
    )
    expect(result).toEqual({ type: "kitchen_module", label: "Кухонный модуль", matched: true })
  })

  it("матчит по признакам (имена фурнитуры), если имя не совпало", () => {
    const techData = emptyTechData()
    techData.fittings.push({
      name: "Штанга овальная",
      code: "SH1",
      objectType: "Фурнитура",
      qty: 1,
      parentPaths: [],
    })
    const rules: ClassifierRule[] = [{ type: "wardrobe", label: "Гардероб", any: ["штанга"] }]
    expect(classifyProduct({ title: "Короб 800", techData }, rules)).toEqual({
      type: "wardrobe",
      label: "Гардероб",
      matched: true,
    })
  })

  it("none отсекает по имени (и только по имени)", () => {
    const rules: ClassifierRule[] = [
      { type: "upper", label: "Верхний модуль", any: ["модуль"], none: ["верх"] },
      { type: "kitchen_module", label: "Кухонный модуль", any: ["модуль", "кухон"] },
    ]
    // «верх» в имени → первое правило отсечено, срабатывает второе.
    expect(
      classifyProduct({ title: "модуль верх", techData: emptyTechData() }, rules).type,
    ).toBe("kitchen_module")
    // «верх» только в признаках — none НЕ срабатывает.
    const techData = emptyTechData()
    techData.panels.push({
      position: "1",
      name: "верх",
      code: "",
      finishedLengthMm: 100,
      finishedWidthMm: 100,
      thicknessMm: 16,
      qty: 1,
      edges: [],
      parentPath: [],
      userProperties: {},
    })
    expect(classifyProduct({ title: "модуль прямой", techData }, rules).type).toBe("upper")
  })

  it("ничего не совпало → universal с matched=false", () => {
    expect(classifyProduct({ title: "полка", techData: emptyTechData() }, RULES)).toEqual({
      type: "universal",
      label: "Универсальный",
      matched: false,
    })
  })
})

describe("classifyDraft на фикстурах", () => {
  it("кухня: модули → kitchen_module, остров → table, прочее → universal", () => {
    const draft = classifyDraft(loadDraft("196.1 кухня+остров.xml"), RULES)
    const byTitle = new Map(draft.products.map((p) => [p.title, p]))

    expect(byTitle.get("остров")?.type).toBe("table")
    expect(byTitle.get("остров")?.typeMatched).toBe(true)
    expect(byTitle.get("фасад ПМ")?.type).toBe("facades")
    for (const title of [
      "модуль угол левый",
      "модуль под мойку",
      "модуль низ прямой",
      "модуль под холодильник",
      "модуль верх",
      "модуль верх простой",
    ]) {
      expect(byTitle.get(title)?.type).toBe("kitchen_module")
    }
    // Совпадения по признакам (имена панелей/профилей в деталировке):
    // «другое» содержит столешницу, «пенал ДШ» — профиль для алюм. фасадов.
    expect(byTitle.get("другое")?.type).toBe("table")
    expect(byTitle.get("пенал ДШ")?.type).toBe("facades")
    // Ни одно правило не совпало → universal, matched=false.
    expect(byTitle.get("Детали вне сборок")?.type).toBe("universal")
    expect(byTitle.get("Детали вне сборок")?.typeMatched).toBe(false)
  })

  it("прихожая: модуль1..8 → kitchen_module, сидушка/другое → universal", () => {
    const draft = classifyDraft(loadDraft("Рома прихожая.xml"), RULES)
    const byTitle = new Map(draft.products.map((p) => [p.title, p]))

    for (let i = 1; i <= 8; i += 1) {
      expect(byTitle.get(`модуль${i}`)?.type).toBe("kitchen_module")
      expect(byTitle.get(`модуль${i}`)?.typeMatched).toBe(true)
    }
    // «сидушка» совпала по признакам (панель «фасад» в деталировке) → facades.
    expect(byTitle.get("сидушка")?.type).toBe("facades")
    expect(byTitle.get("сидушка")?.typeMatched).toBe(true)
    expect(byTitle.get("другое")?.type).toBe("universal")
    expect(byTitle.get("другое")?.typeMatched).toBe(false)
  })

  it("полка: единственное изделие → universal (matched=false)", () => {
    const draft = classifyDraft(loadDraft("175.33 Полка Облачко 2шт Детская 2.xml"), RULES)
    expect(draft.products).toHaveLength(1)
    expect(draft.products[0]?.type).toBe("universal")
    expect(draft.products[0]?.typeMatched).toBe(false)
  })

  it("не трогает изделия с уже заданным типом (повторный preview после правок)", () => {
    const draft = loadDraft("175.33 Полка Облачко 2шт Детская 2.xml")
    const manual = {
      ...draft,
      products: draft.products.map((p) => ({ ...p, type: "shkaf" as const })),
    }
    const result = classifyDraft(manual, RULES)
    expect(result.products[0]?.type).toBe("shkaf")
    expect(result.products[0]?.typeMatched).toBeUndefined()
  })
})
