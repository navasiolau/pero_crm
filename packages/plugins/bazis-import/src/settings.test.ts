// Тесты валидации настроек плагина (PUT /api/bazis-import/settings использует её же).
import { describe, expect, it } from "vitest"

import { DEFAULT_SETTINGS, validateBazisSettings } from "./settings"

describe("validateBazisSettings", () => {
  it("принимает DEFAULT_SETTINGS", () => {
    const result = validateBazisSettings(DEFAULT_SETTINGS)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.productTemplates.length).toBeGreaterThan(0)
    }
  })

  it("нормализует: отбрасывает лишние поля, type в задаче опционален", () => {
    const result = validateBazisSettings({
      classifierRules: [{ type: "shkaf", label: "Шкаф", any: ["шкаф"], junk: 1 }],
      productTemplates: [
        {
          type: "universal",
          label: "Универсальный",
          works: [{ priceItemId: "p1", qtyRule: "panels_m2", factor: 1.5 }],
          tasks: [{ title: "Раскрой", estimateMinutes: 60, dependsOn: [] }],
        },
      ],
      materialMap: [{ bazisName: "ЛДСП 16", materialId: "m1" }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.classifierRules[0]).toEqual({
        type: "shkaf",
        label: "Шкаф",
        any: ["шкаф"],
      })
    }
  })

  it("отклоняет цикл в задачах шаблона", () => {
    const result = validateBazisSettings({
      classifierRules: [],
      productTemplates: [
        {
          type: "universal",
          label: "Универсальный",
          works: [],
          tasks: [
            { title: "a", estimateMinutes: 10, dependsOn: [1] },
            { title: "b", estimateMinutes: 10, dependsOn: [0] },
          ],
        },
      ],
      materialMap: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("Цикл")
  })

  it("отклоняет зависимость вне массива и нулевую оценку", () => {
    const base = {
      classifierRules: [],
      productTemplates: [
        {
          type: "universal",
          label: "Универсальный",
          works: [],
          tasks: [{ title: "a", estimateMinutes: 10, dependsOn: [3] }],
        },
      ],
      materialMap: [],
    }
    expect(validateBazisSettings(base).ok).toBe(false)
    const zeroEstimate = structuredClone(base)
    zeroEstimate.productTemplates[0]!.tasks[0] = {
      title: "a",
      estimateMinutes: 0,
      dependsOn: [],
    }
    const result = validateBazisSettings(zeroEstimate)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("оценка времени")
  })

  it("отклоняет дубли типов и неизвестный qtyRule", () => {
    const dup = validateBazisSettings({
      classifierRules: [
        { type: "shkaf", label: "Шкаф", any: ["шкаф"] },
        { type: "shkaf", label: "Шкаф 2", any: ["корпус"] },
      ],
      productTemplates: [],
      materialMap: [],
    })
    expect(dup.ok).toBe(false)

    const badRule = validateBazisSettings({
      classifierRules: [],
      productTemplates: [
        {
          type: "universal",
          label: "Универсальный",
          works: [{ priceItemId: "p1", qtyRule: "magic" }],
          tasks: [],
        },
      ],
      materialMap: [],
    })
    expect(badRule.ok).toBe(false)
    if (!badRule.ok) expect(badRule.error).toContain("qtyRule")
  })
})
