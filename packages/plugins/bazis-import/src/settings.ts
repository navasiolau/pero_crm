// Настройки плагина (этап B): правила классификатора, шаблоны работ/задач
// по типам изделий, карта материалов (этап C). Хранятся в PluginSetting
// (ключи classifierRules / productTemplates / materialMap, значение — Json).
// Ядровое savePluginSettings для них НЕ подходит (оно фильтрует ключи по
// settingsSchema манифеста — только примитивы), поэтому чтение/запись —
// через роуты apps/web/src/app/api/bazis-import/settings/.

import { validateDag } from "./templates"

/** Правило классификатора: первое совпавшее побеждает (порядок = приоритет). */
export interface ClassifierRule {
  type: string
  label: string
  /** Подстроки: матч, если хотя бы одна встречается в имени изделия ИЛИ в признаках (фурнитура/материалы). */
  any: string[]
  /** Подстроки-исключения: проверяются ТОЛЬКО по имени изделия. */
  none?: string[]
}

/** Правило количества работы из агрегатов изделия. */
export type QtyRule = "panels_m2" | "edging_m" | "boxes_count" | "panels_count" | "fixed"

export const QTY_RULES: QtyRule[] = [
  "panels_m2",
  "edging_m",
  "boxes_count",
  "panels_count",
  "fixed",
]

/** Работа шаблона: расценка из прайса + правило количества. */
export interface TemplateWork {
  priceItemId: string
  qtyRule: QtyRule
  /** Множитель количества (по умолчанию 1); при qtyRule "fixed" — само количество. */
  factor?: number
}

/** Задача шаблона; dependsOn — индексы в массиве tasks этого же шаблона. */
export interface TemplateTask {
  title: string
  type?: string
  estimateMinutes: number
  dependsOn: number[]
}

/** Техпроцесс типа изделия: работы + цепочка задач. */
export interface ProductTemplate {
  type: string
  label: string
  works: TemplateWork[]
  tasks: TemplateTask[]
}

/** Соответствие материала Базиса номенклатуре склада (этап C). */
export interface MaterialMapEntry {
  bazisName: string
  bazisCode?: string
  materialId: string
}

export interface BazisSettings {
  classifierRules: ClassifierRule[]
  productTemplates: ProductTemplate[]
  materialMap: MaterialMapEntry[]
}

/** Тип по умолчанию для нераспознанных изделий. */
export const UNIVERSAL_TYPE = "universal"
export const UNIVERSAL_LABEL = "Универсальный"

/** Ключи PluginSetting. */
export const SETTING_KEYS = {
  classifierRules: "classifierRules",
  productTemplates: "productTemplates",
  materialMap: "materialMap",
} as const

/** Общая цепочка задач техпроцесса (подготовка → контроль), оценки в минутах. */
function defaultTasks(estimates: [number, number, number, number, number, number]): TemplateTask[] {
  const titles = [
    "Подготовить деталировку",
    "Раскрой",
    "Кромка",
    "Присадка",
    "Сборка",
    "Контроль",
  ]
  return titles.map((title, index) => ({
    title,
    estimateMinutes: estimates[index] ?? 30,
    dependsOn: index === 0 ? [] : [index - 1],
  }))
}

/**
 * Стартовый набор (§3 техплана). works пустые: id расценок заранее
 * неизвестны, привязку к прайсу делает админ в настройках плагина.
 * Правила классификатора осознанно простые — правятся в UI.
 */
export const DEFAULT_SETTINGS: BazisSettings = {
  classifierRules: [
    { type: "kitchen_module", label: "Кухонный модуль", any: ["модуль", "кухон"] },
    { type: "shkaf", label: "Шкаф", any: ["шкаф", "корпус", "прихож", "гардероб"] },
    { type: "table", label: "Стол/остров", any: ["стол", "остров"] },
    { type: "facades", label: "Фасады", any: ["фасад", "дверь", "дверц"] },
  ],
  productTemplates: [
    { type: UNIVERSAL_TYPE, label: UNIVERSAL_LABEL, works: [], tasks: defaultTasks([30, 60, 45, 45, 120, 15]) },
    { type: "kitchen_module", label: "Кухонный модуль", works: [], tasks: defaultTasks([30, 90, 60, 60, 150, 15]) },
    { type: "shkaf", label: "Шкаф", works: [], tasks: defaultTasks([40, 90, 60, 60, 180, 20]) },
  ],
  materialMap: [],
}

// ---------------------------------------------------------------------------
// Валидация настроек (структура + DAG шаблонов). Используется PUT-роутом.
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== ""

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

function parseClassifierRule(value: unknown, index: number): ClassifierRule | string {
  if (!isRecord(value)) return `Правило классификатора №${index + 1}: не объект`
  if (!isNonEmptyString(value.type)) return `Правило №${index + 1}: пустой тип`
  if (!isNonEmptyString(value.label)) return `Правило «${value.type}»: пустое название`
  if (!isStringArray(value.any) || value.any.length === 0) {
    return `Правило «${value.type}»: список any пуст или не строки`
  }
  if (value.none !== undefined && !isStringArray(value.none)) {
    return `Правило «${value.type}»: none должно быть списком строк`
  }
  return {
    type: value.type.trim(),
    label: value.label.trim(),
    any: value.any,
    ...(value.none !== undefined ? { none: value.none } : {}),
  }
}

function parseTemplateWork(value: unknown, where: string): TemplateWork | string {
  if (!isRecord(value)) return `${where}: работа не объект`
  if (!isNonEmptyString(value.priceItemId)) return `${where}: работа без priceItemId`
  if (!QTY_RULES.includes(value.qtyRule as QtyRule)) {
    return `${where}: неизвестный qtyRule «${String(value.qtyRule)}»`
  }
  if (value.factor !== undefined && (typeof value.factor !== "number" || !(value.factor > 0))) {
    return `${where}: factor должен быть положительным числом`
  }
  return {
    priceItemId: value.priceItemId,
    qtyRule: value.qtyRule as QtyRule,
    ...(value.factor !== undefined ? { factor: value.factor } : {}),
  }
}

function parseTemplateTask(value: unknown, where: string, tasksCount: number): TemplateTask | string {
  if (!isRecord(value)) return `${where}: задача не объект`
  if (!isNonEmptyString(value.title)) return `${where}: задача без названия`
  if (typeof value.estimateMinutes !== "number" || !(value.estimateMinutes > 0)) {
    return `${where}: у задачи «${String(value.title)}» оценка времени должна быть > 0`
  }
  if (!Array.isArray(value.dependsOn) || !value.dependsOn.every((i) => Number.isInteger(i))) {
    return `${where}: у задачи «${value.title}» dependsOn должен быть списком индексов`
  }
  for (const depIndex of value.dependsOn as number[]) {
    if (depIndex < 0 || depIndex >= tasksCount) {
      return `${where}: у задачи «${value.title}» зависимость №${depIndex + 1} вне списка задач`
    }
  }
  return {
    title: value.title.trim(),
    ...(value.type !== undefined && typeof value.type === "string" && value.type.trim() !== ""
      ? { type: value.type.trim() }
      : {}),
    estimateMinutes: value.estimateMinutes,
    dependsOn: value.dependsOn as number[],
  }
}

function parseTemplate(value: unknown, index: number): ProductTemplate | string {
  if (!isRecord(value)) return `Шаблон №${index + 1}: не объект`
  if (!isNonEmptyString(value.type)) return `Шаблон №${index + 1}: пустой тип`
  if (!isNonEmptyString(value.label)) return `Шаблон «${value.type}»: пустое название`
  const where = `Шаблон «${value.type}»`

  if (!Array.isArray(value.works)) return `${where}: works должен быть списком`
  const works: TemplateWork[] = []
  for (const work of value.works) {
    const parsed = parseTemplateWork(work, where)
    if (typeof parsed === "string") return parsed
    works.push(parsed)
  }

  if (!Array.isArray(value.tasks)) return `${where}: tasks должен быть списком`
  const tasks: TemplateTask[] = []
  for (const task of value.tasks) {
    const parsed = parseTemplateTask(task, where, value.tasks.length)
    if (typeof parsed === "string") return parsed
    tasks.push(parsed)
  }
  const dagError = validateDag(tasks)
  if (dagError) return `${where}: ${dagError}`

  return { type: value.type.trim(), label: value.label.trim(), works, tasks }
}

function parseMaterialMapEntry(value: unknown, index: number): MaterialMapEntry | string {
  if (!isRecord(value)) return `Соответствие материала №${index + 1}: не объект`
  if (!isNonEmptyString(value.bazisName)) return `Соответствие №${index + 1}: пустое имя материала Базиса`
  if (!isNonEmptyString(value.materialId)) return `Соответствие «${value.bazisName}»: не выбран материал склада`
  if (value.bazisCode !== undefined && typeof value.bazisCode !== "string") {
    return `Соответствие «${value.bazisName}»: bazisCode должно быть строкой`
  }
  return {
    bazisName: value.bazisName.trim(),
    ...(typeof value.bazisCode === "string" && value.bazisCode.trim() !== ""
      ? { bazisCode: value.bazisCode.trim() }
      : {}),
    materialId: value.materialId,
  }
}

/** Валидация списка соответствий материалов (PUT settings/material-map, этап C). */
export function validateMaterialMapEntries(
  raw: unknown,
): { ok: true; entries: MaterialMapEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "entries должен быть списком" }
  }
  const entries: MaterialMapEntry[] = []
  for (const [index, value] of raw.entries()) {
    const parsed = parseMaterialMapEntry(value, index)
    if (typeof parsed === "string") return { ok: false, error: parsed }
    entries.push(parsed)
  }
  return { ok: true, entries }
}

/** Структурная валидация + DAG-проверка шаблонов. Ошибки — по-русски, для 400-ответа. */
export function validateBazisSettings(
  raw: unknown,
): { ok: true; settings: BazisSettings } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Настройки должны быть объектом" }

  if (!Array.isArray(raw.classifierRules)) {
    return { ok: false, error: "classifierRules должен быть списком" }
  }
  const classifierRules: ClassifierRule[] = []
  const ruleTypes = new Set<string>()
  for (const [index, rule] of raw.classifierRules.entries()) {
    const parsed = parseClassifierRule(rule, index)
    if (typeof parsed === "string") return { ok: false, error: parsed }
    if (ruleTypes.has(parsed.type)) {
      return { ok: false, error: `Правило классификатора «${parsed.type}» повторяется` }
    }
    ruleTypes.add(parsed.type)
    classifierRules.push(parsed)
  }

  if (!Array.isArray(raw.productTemplates)) {
    return { ok: false, error: "productTemplates должен быть списком" }
  }
  const productTemplates: ProductTemplate[] = []
  const templateTypes = new Set<string>()
  for (const [index, template] of raw.productTemplates.entries()) {
    const parsed = parseTemplate(template, index)
    if (typeof parsed === "string") return { ok: false, error: parsed }
    if (templateTypes.has(parsed.type)) {
      return { ok: false, error: `Шаблон «${parsed.type}» повторяется` }
    }
    templateTypes.add(parsed.type)
    productTemplates.push(parsed)
  }

  if (!Array.isArray(raw.materialMap)) {
    return { ok: false, error: "materialMap должен быть списком" }
  }
  const materialMap: MaterialMapEntry[] = []
  for (const [index, entry] of raw.materialMap.entries()) {
    const parsed = parseMaterialMapEntry(entry, index)
    if (typeof parsed === "string") return { ok: false, error: parsed }
    materialMap.push(parsed)
  }

  return { ok: true, settings: { classifierRules, productTemplates, materialMap } }
}
