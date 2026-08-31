// Тесты разбора XML (xml.ts): сырые счётчики по 3 эталонным фикстурам
// и обработка ошибок формата.
//
// Эталоны подсчитаны независимо от парсера — скриптом на Python
// (xml.etree.ElementTree) прямым обходом дерева.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { BazisDocument, BazisElement } from "./types"
import { BazisParseError, parseBazisXml } from "./xml"

const FIXTURES = {
  shelf: "175.33 Полка Облачко 2шт Детская 2.xml",
  kitchen: "196.1 кухня+остров.xml",
  hallway: "Рома прихожая.xml",
} as const

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))
}

function parseFixture(name: string): BazisDocument {
  return parseBazisXml(readFileSync(fixturePath(name), "utf8"))
}

/** Сырые счётчики по всему дереву (без учёта кратностей). */
function rawCounters(doc: BazisDocument): {
  panels: number
  profiles: number
  fittings: number
  fittingAssemblies: number
  containers: number
  fittingsQty: number
} {
  const counters = {
    panels: 0,
    profiles: 0,
    fittings: 0,
    fittingAssemblies: 0,
    containers: 0,
    fittingsQty: 0,
  }
  const walk = (elements: BazisElement[]): void => {
    for (const element of elements) {
      if (element.kind === "container") {
        counters.containers += 1
        walk(element.children)
      } else if (element.kind === "panel") {
        counters.panels += 1
      } else if (element.kind === "profile") {
        counters.profiles += 1
      } else {
        if (element.objectType === "Фурнитура") {
          counters.fittings += 1
          counters.fittingsQty += element.qty
        } else {
          counters.fittingAssemblies += 1
        }
      }
    }
  }
  for (const root of doc.products) walk(root.elements)
  return counters
}

describe("parseBazisXml — заголовок документа", () => {
  it("читает атрибуты Проект и единственное Изделие", () => {
    const doc = parseFixture(FIXTURES.shelf)
    expect(doc.projectName).toBe("175.33")
    expect(doc.version).toBe("10.6.2.25670")
    expect(doc.products).toHaveLength(1)
    expect(doc.products[0]?.name).toBe("Полка Облачко 2шт Детская 2.")
  })

  it("срезает UTF-8 BOM", () => {
    const doc = parseBazisXml(
      "﻿<?xml version=\"1.0\" encoding=\"UTF-8\"?><Проект Наименование=\"Т\"><Изделие><Наименование>И</Наименование><Количество>1</Количество></Изделие></Проект>",
    )
    expect(doc.projectName).toBe("Т")
  })
})

describe("parseBazisXml — сырые счётчики по фикстурам", () => {
  it("полка-облако: 1 панель, ничего больше", () => {
    const counters = rawCounters(parseFixture(FIXTURES.shelf))
    expect(counters).toEqual({
      panels: 1,
      profiles: 0,
      fittings: 0,
      fittingAssemblies: 0,
      containers: 1,
      fittingsQty: 0,
    })
  })

  it("кухня: 256 панелей, 37 профилей, 305 фурнитуры (640 шт), 161 сборка-элемент", () => {
    const counters = rawCounters(parseFixture(FIXTURES.kitchen))
    expect(counters.panels).toBe(256)
    expect(counters.profiles).toBe(37)
    expect(counters.fittings).toBe(305)
    expect(counters.fittingsQty).toBe(640)
    expect(counters.fittingAssemblies).toBe(161)
    expect(counters.containers).toBe(842 + 28) // Сборка + Блок
  })

  it("прихожая: 171 панель, 24 профиля, 279 фурнитуры (583 шт), 100 сборок-элементов", () => {
    const counters = rawCounters(parseFixture(FIXTURES.hallway))
    expect(counters.panels).toBe(171)
    expect(counters.profiles).toBe(24)
    expect(counters.fittings).toBe(279)
    expect(counters.fittingsQty).toBe(583)
    expect(counters.fittingAssemblies).toBe(100)
    expect(counters.containers).toBe(430 + 31)
  })
})

describe("parseBazisXml — структура панели", () => {
  it("полка: габариты, кромки по чертежу, материал, свойства", () => {
    const doc = parseFixture(FIXTURES.shelf)
    const block = doc.products[0]?.elements[0]
    expect(block?.kind).toBe("container")
    if (block?.kind !== "container") return
    const panel = block.children[0]
    expect(panel?.kind).toBe("panel")
    if (panel?.kind !== "panel") return

    expect(panel.name).toBe("облако")
    expect(panel.finishedLengthMm).toBeCloseTo(380.282, 3)
    expect(panel.finishedWidthMm).toBeCloseTo(799.871, 3)
    expect(panel.thicknessMm).toBe(19)
    expect(panel.material?.name).toBe("МДФ 19 мм")
    expect(panel.material?.qty).toBeCloseTo(0.3042, 4)
    // Все 16 кромок — «по чертежу», списки сторон 1–4 пустые (заглушки отброшены).
    expect(panel.edges).toHaveLength(16)
    expect(panel.edges.every((edge) => edge.side === "drawing")).toBe(true)
    expect(panel.userProperties).toEqual({ цвет: "RAL 9003" })
  })

  it("пустые теги (<Код/> и т.п.) приходят как пустые строки, а не объекты", () => {
    const doc = parseFixture(FIXTURES.shelf)
    const block = doc.products[0]?.elements[0]
    if (block?.kind !== "container") throw new Error("ожидался контейнер")
    const panel = block.children[0]
    if (panel?.kind !== "panel") throw new Error("ожидалась панель")
    expect(panel.code).toBe("")
    expect(typeof panel.code).toBe("string")
  })
})

describe("parseBazisXml — ошибки формата", () => {
  it("чужой корень → BazisParseError по-русски", () => {
    expect(() => parseBazisXml("<?xml version=\"1.0\"?><Каталог/>")).toThrow(BazisParseError)
    expect(() => parseBazisXml("<?xml version=\"1.0\"?><Каталог/>")).toThrow(
      /ожидался корневой элемент <Проект>/,
    )
  })

  it("битый XML → BazisParseError", () => {
    expect(() => parseBazisXml("<Проект><Изделие>")).toThrow(BazisParseError)
  })

  it("Проект без Изделие → BazisParseError", () => {
    expect(() => parseBazisXml("<Проект Наименование=\"П\"/>")).toThrow(/Изделие/)
  })
})
