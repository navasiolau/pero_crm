// Разбор XML-спецификации Базис-Мебельщик в сырую модель BazisDocument.
// Формат: UTF-8 (с BOM), русские теги, корень <Проект> → <Изделие> →
// <СписокЭлементов> → рекурсивно <Блок>/<Сборка>/<Объект>.

import { XMLParser, XMLValidator } from "fast-xml-parser"

import type {
  BazisContainer,
  BazisDocument,
  BazisEdge,
  BazisElement,
  BazisFitting,
  BazisMaterialRef,
  BazisPanel,
  BazisProductRoot,
  BazisProfile,
} from "./types"

/** Ошибка разбора файла Базиса — сообщение показывается пользователю. */
export class BazisParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BazisParseError"
  }
}

type RawNode = Record<string, unknown>

/** Теги, которые могут повторяться, — всегда приводим к массиву. */
const ARRAY_TAGS = new Set([
  "Изделие",
  "Объект",
  "Сборка",
  "Блок",
  "Кромка",
  "СопутствующийМатериал",
  "Свойство",
  "Отверстие",
])

const EDGE_LIST_TAGS = [
  "СписокКромок1",
  "СписокКромок2",
  "СписокКромок3",
  "СписокКромок4",
] as const
const EDGE_DRAWING_TAG = "СписокКромокСМЧертеж"

function asObj(value: unknown): RawNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawNode)
    : undefined
}

/** Значение как массив узлов: массив → он сам, объект → [объект], пустое → []. */
function asArr(value: unknown): RawNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const obj = asObj(item)
      return obj ? [obj] : []
    })
  }
  const obj = asObj(value)
  return obj ? [obj] : []
}

/** Текстовое значение тега; пустой/самозакрывающийся тег → "". */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function childText(node: RawNode, tag: string): string {
  return text(node[tag])
}

/** Число из тега; пустое/отсутствующее → fallback. */
function childNum(node: RawNode, tag: string, fallback = 0): number {
  const raw = childText(node, tag)
  if (raw === "") return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function parseMaterial(node: RawNode | undefined): BazisMaterialRef | undefined {
  if (!node) return undefined
  const name = childText(node, "Наименование")
  if (name === "") return undefined
  const thickness = childNum(node, "Толщина")
  const note = childText(node, "Примечание")
  return {
    name,
    code: childText(node, "Код"),
    qty: childNum(node, "Количество"),
    unit: childText(node, "ЕдИзм"),
    ...(thickness > 0 ? { thicknessMm: thickness } : {}),
    ...(note !== "" ? { note } : {}),
  }
}

function parseExtraMaterials(node: RawNode): BazisMaterialRef[] {
  const list = asObj(node["СопутствующиеМатериалы"])
  if (!list) return []
  return asArr(list["СопутствующийМатериал"]).flatMap((item) => {
    const material = parseMaterial(item)
    return material ? [material] : []
  })
}

function parseUserProperties(node: RawNode): Record<string, string> {
  const list = asObj(node["ПользовательскиеСвойства"])
  if (!list) return {}
  const result: Record<string, string> = {}
  for (const prop of asArr(list["Свойство"])) {
    const key = childText(prop, "Имя")
    if (key !== "") result[key] = childText(prop, "Значение")
  }
  return result
}

function parseEdges(panel: RawNode): BazisEdge[] {
  const edges: BazisEdge[] = []
  const lists: [string, BazisEdge["side"]][] = [
    ...EDGE_LIST_TAGS.map(
      (tag, index) => [tag, (index + 1) as 1 | 2 | 3 | 4] as [string, BazisEdge["side"]],
    ),
    [EDGE_DRAWING_TAG, "drawing"],
  ]
  for (const [tag, side] of lists) {
    for (const raw of asArr(asObj(panel[tag])?.["Кромка"])) {
      const name = childText(raw, "Наименование")
      // Пустая кромка-заглушка (<Наименование/> и нулевая длина) — не кромка.
      if (name === "") continue
      edges.push({
        side,
        name,
        code: childText(raw, "Код"),
        lengthMm: childNum(raw, "Длина"),
        widthMm: childNum(raw, "Ширина"),
        thicknessMm: childNum(raw, "Толщина"),
        designation: childText(raw, "Обозначение"),
      })
    }
  }
  return edges
}

function parseDims(node: RawNode): BazisContainer["dims"] {
  const width = childNum(node, "Ширина")
  const height = childNum(node, "Высота")
  const depth = childNum(node, "Глубина")
  if (width === 0 && height === 0 && depth === 0) return undefined
  return {
    ...(width > 0 ? { widthMm: width } : {}),
    ...(height > 0 ? { heightMm: height } : {}),
    ...(depth > 0 ? { depthMm: depth } : {}),
  }
}

function parsePanel(node: RawNode): BazisPanel {
  const grain = childText(node, "ОриентацияТекстуры")
  return {
    kind: "panel",
    name: childText(node, "Наименование"),
    code: childText(node, "Код"),
    qty: childNum(node, "Количество", 1),
    position: childText(node, "Позиция"),
    lengthMm: childNum(node, "Длина"),
    widthMm: childNum(node, "Ширина"),
    finishedLengthMm: childNum(node, "Длина_готовой_детали"),
    finishedWidthMm: childNum(node, "Ширина_готовой_детали"),
    thicknessMm: childNum(node, "ОбщаяТолщина"),
    ...(grain !== "" ? { grainDirection: grain } : {}),
    edges: parseEdges(node),
    material: parseMaterial(asObj(node["ОсновнойМатериал"])),
    extraMaterials: parseExtraMaterials(node),
    userProperties: parseUserProperties(node),
  }
}

function parseProfile(node: RawNode): BazisProfile {
  return {
    kind: "profile",
    name: childText(node, "Наименование"),
    code: childText(node, "Код"),
    qty: childNum(node, "Количество", 1),
    position: childText(node, "Позиция"),
    lengthMm: childNum(node, "Длина"),
    material: parseMaterial(asObj(node["ОсновнойМатериал"])),
    extraMaterials: parseExtraMaterials(node),
  }
}

function parseFitting(node: RawNode, objectType: string): BazisFitting {
  return {
    kind: "fitting",
    objectType,
    name: childText(node, "Наименование"),
    code: childText(node, "Код"),
    qty: childNum(node, "Количество", 1),
    position: childText(node, "Позиция"),
    material: parseMaterial(asObj(node["ОсновнойМатериал"])),
    extraMaterials: parseExtraMaterials(node),
  }
}

function parseContainer(node: RawNode, tag: "Сборка" | "Блок"): BazisContainer {
  return {
    kind: "container",
    tag,
    objectType: childText(node, "ТипОбъекта"),
    name: childText(node, "Наименование"),
    qty: childNum(node, "Количество", 1),
    position: childText(node, "Позиция"),
    dims: parseDims(node),
    children: parseElements(asObj(node["СписокЭлементов"])),
  }
}

function parseElement(node: RawNode, tag: string): BazisElement | undefined {
  if (tag === "Блок" || tag === "Сборка") {
    return parseContainer(node, tag)
  }
  if (tag === "Объект") {
    const objectType = childText(node, "ТипОбъекта")
    if (objectType === "Панель") return parsePanel(node)
    if (objectType === "Профиль") return parseProfile(node)
    // Прочие листовые объекты (Фурнитура, Сборка-элемент и др.) — фурнитура.
    return parseFitting(node, objectType)
  }
  // Неизвестные теги (ДобавленоВручную и т.п.) внутри списков пропускаем.
  return undefined
}

function parseElements(list: RawNode | undefined): BazisElement[] {
  if (!list) return []
  const elements: BazisElement[] = []
  for (const tag of ["Блок", "Сборка", "Объект"] as const) {
    // Порядок следования тегов внутри СписокЭлементов не сохраняется
    // fast-xml-parser'ом (preserveOrder выключен) — в фикстурах порядок
    // верхнего уровня не значим, ключи строятся по индексу в итоговом списке.
    for (const node of asArr(list[tag])) {
      const element = parseElement(node, tag)
      if (element) elements.push(element)
    }
  }
  return elements
}

function parseProductRoot(node: RawNode): BazisProductRoot {
  // Материалы, добавленные вручную на уровне изделия (в фикстурах пусто).
  const manual: BazisMaterialRef[] = []
  for (const manualNode of asArr(node["ДобавленоВручную"])) {
    manual.push(...parseExtraMaterials(manualNode))
  }
  return {
    name: childText(node, "Наименование"),
    qty: childNum(node, "Количество", 1),
    elements: parseElements(asObj(node["СписокЭлементов"])),
    manualMaterials: manual,
  }
}

/**
 * Разбирает XML-строку спецификации Базис-Мебельщик.
 * @throws {BazisParseError} при битом XML или чужом формате.
 */
export function parseBazisXml(xml: string): BazisDocument {
  // Срезаем UTF-8 BOM — fast-xml-parser его не переваривает в начале.
  const source = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml

  const validation = XMLValidator.validate(source)
  if (validation !== true) {
    throw new BazisParseError(
      `Файл не является корректным XML: ${validation.err.msg} (строка ${validation.err.line})`,
    )
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false, // числа разбираем сами — пустые теги приходят как ""
    trimValues: true,
    isArray: (tagName) => ARRAY_TAGS.has(tagName),
  })

  let parsed: unknown
  try {
    parsed = parser.parse(source)
  } catch (error) {
    throw new BazisParseError(
      `Не удалось разобрать XML: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const root = asObj(asObj(parsed)?.["Проект"])
  if (!root) {
    throw new BazisParseError(
      "Файл не похож на спецификацию Базис-Мебельщик: ожидался корневой элемент <Проект>",
    )
  }

  const products = asArr(root["Изделие"]).map(parseProductRoot)
  if (products.length === 0) {
    throw new BazisParseError("В файле нет ни одного элемента <Изделие>")
  }

  const projectName = text(root["@_Наименование"])
  const projectNumber = text(root["@_Номер"])
  const version = text(root["@_Версия"])
  return {
    projectName,
    ...(projectNumber !== "" ? { projectNumber } : {}),
    ...(version !== "" ? { version } : {}),
    products,
  }
}
