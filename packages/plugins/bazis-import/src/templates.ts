// Движок шаблонов работ/задач (этап B): DAG-валидация, выбор шаблона по типу,
// количества из агрегатов изделия (qtyRule), разворачивание шаблона в
// работы (снимок цены из прайса) и задачи-черновики.

import type { DraftProduct, DraftTask, DraftWork, DraftQuantities, TechData } from "./parser/types"
import type { BazisSettings, ProductTemplate, QtyRule, TemplateTask } from "./settings"
import { UNIVERSAL_LABEL, UNIVERSAL_TYPE } from "./settings"

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ---------------------------------------------------------------------------
// DAG задач шаблона (зависимости — индексы в массиве)
// ---------------------------------------------------------------------------

/** Проверка DAG: цикл, самоссылка или индекс вне диапазона → текст ошибки, иначе null. */
export function validateDag(tasks: TemplateTask[]): string | null {
  for (const [index, task] of tasks.entries()) {
    for (const dep of task.dependsOn) {
      if (!Number.isInteger(dep) || dep < 0 || dep >= tasks.length) {
        return `Задача «${task.title}»: зависимость №${dep + 1} вне списка задач`
      }
      if (dep === index) {
        return `Задача «${task.title}» зависит сама от себя`
      }
    }
  }
  // Поиск цикла раскраской (0 — не посещена, 1 — в стеке, 2 — обработана).
  const state = new Array<number>(tasks.length).fill(0)
  const visit = (index: number): boolean => {
    if (state[index] === 1) return false
    if (state[index] === 2) return true
    state[index] = 1
    for (const dep of tasks[index]?.dependsOn ?? []) {
      if (!visit(dep)) return false
    }
    state[index] = 2
    return true
  }
  for (let index = 0; index < tasks.length; index += 1) {
    if (!visit(index)) {
      return "Цикл в зависимостях задач шаблона"
    }
  }
  return null
}

/**
 * Топологический порядок индексов задач (предшественники раньше потомков).
 * Детерминированный: при равенстве — по возрастанию индекса (алгоритм Кана
 * с выбором минимального готового индекса). При цикле возвращает обход
 * в исходном порядке — валидность проверяет validateDag.
 */
export function topoOrder(tasks: TemplateTask[]): number[] {
  const indegree = new Array<number>(tasks.length).fill(0)
  const dependents: number[][] = tasks.map(() => [])
  for (const [index, task] of tasks.entries()) {
    for (const dep of task.dependsOn) {
      if (dep >= 0 && dep < tasks.length && dep !== index) {
        indegree[index] += 1
        dependents[dep]?.push(index)
      }
    }
  }
  const ready = tasks.map((_, index) => index).filter((index) => indegree[index] === 0)
  const order: number[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => a - b)
    const index = ready.shift() as number
    order.push(index)
    for (const next of dependents[index] ?? []) {
      indegree[next] -= 1
      if (indegree[next] === 0) ready.push(next)
    }
  }
  if (order.length !== tasks.length) {
    // Цикл (шаблон невалиден) — отдаём исходный порядок, чтобы не терять задачи.
    return tasks.map((_, index) => index)
  }
  return order
}

// ---------------------------------------------------------------------------
// Выбор шаблона и количества
// ---------------------------------------------------------------------------

/** Шаблон по типу изделия; нет — universal; нет и его — пустой. */
export function resolveTemplate(type: string, settings: BazisSettings): ProductTemplate {
  const byType = settings.productTemplates.find((template) => template.type === type)
  if (byType) return byType
  const universal = settings.productTemplates.find(
    (template) => template.type === UNIVERSAL_TYPE,
  )
  if (universal) return universal
  return { type: UNIVERSAL_TYPE, label: UNIVERSAL_LABEL, works: [], tasks: [] }
}

/**
 * Количества изделия из его techData — запасной путь для драфтов,
 * где normalize не проставил DraftProduct.quantities (старые драфты,
 * будущий .pero.json). boxesCount здесь — приближение: считаем РАЗЛИЧНЫЕ
 * пути контейнеров «ящик»/«короб ящика» из parentPath панелей и профилей
 * (кратность контейнеров в techData не сохраняется; в фикстурах она = 1).
 */
export function productQuantities(techData: TechData): DraftQuantities {
  const round4 = (value: number) => round(value, 4)
  const panelsM2 = techData.materials
    .filter((material) => material.unit === "m2")
    .reduce((sum, material) => sum + material.qty, 0)
  const edgingMm = techData.edging.reduce((sum, edge) => sum + edge.lengthMm, 0)
  const boxPaths = new Set<string>()
  const isBox = (name: string) => {
    const normalized = name.trim().toLowerCase()
    return normalized.startsWith("ящик") || normalized.startsWith("короб ящика")
  }
  for (const item of [...techData.panels, ...techData.profiles]) {
    for (let i = 0; i < item.parentPath.length; i += 1) {
      const name = item.parentPath[i]
      if (name !== undefined && isBox(name)) {
        boxPaths.add(item.parentPath.slice(0, i + 1).join(" / "))
      }
    }
  }
  return {
    panelsCount: techData.panels.reduce((sum, panel) => sum + panel.qty, 0),
    panelsM2: round4(panelsM2),
    edgingM: round(edgingMm / 1000, 3),
    boxesCount: boxPaths.size,
  }
}

/** Количество работы по правилу шаблона; округление до 2 знаков. */
export function computeWorkQty(
  rule: QtyRule,
  factor: number | undefined,
  q: Pick<DraftQuantities, "panelsM2" | "edgingM" | "boxesCount" | "panelsCount">,
): number {
  if (rule === "fixed") return round(factor ?? 1, 2)
  const base =
    rule === "panels_m2"
      ? q.panelsM2
      : rule === "edging_m"
        ? q.edgingM
        : rule === "boxes_count"
          ? q.boxesCount
          : q.panelsCount
  return round(base * (factor ?? 1), 2)
}

// ---------------------------------------------------------------------------
// Разворачивание шаблона в работы/задачи изделия
// ---------------------------------------------------------------------------

/** Расценка из прайса, нужная движку (цена может прийти Decimal из Prisma). */
export interface PriceItemInfo {
  price: number | string
  name: string
  unit: string
  active: boolean
}

export interface ExpandResult {
  works: DraftWork[]
  tasks: DraftTask[]
  problems: string[]
}

/**
 * Разворачивает шаблон для изделия: работы со снимком цены и количеством
 * по qtyRule + задачи-черновики. Работа с неизвестной/неактивной расценкой
 * или нулевым количеством пропускается — с пояснением в problems.
 */
export function expandTemplate(
  template: ProductTemplate,
  product: DraftProduct,
  ctx: { priceItems: Map<string, PriceItemInfo> },
): ExpandResult {
  const problems: string[] = []
  const works: DraftWork[] = []
  const quantities = product.quantities ?? productQuantities(product.techData)

  for (const templateWork of template.works) {
    const priceItem = ctx.priceItems.get(templateWork.priceItemId)
    if (!priceItem) {
      problems.push(`Работа пропущена: расценка не найдена (${templateWork.priceItemId})`)
      continue
    }
    if (!priceItem.active) {
      problems.push(`Работа «${priceItem.name}» пропущена: расценка неактивна`)
      continue
    }
    const quantity = computeWorkQty(templateWork.qtyRule, templateWork.factor, quantities)
    if (quantity <= 0) {
      problems.push(`Работа «${priceItem.name}» пропущена: нулевое количество`)
      continue
    }
    const price = Number(priceItem.price)
    works.push({
      priceItemId: templateWork.priceItemId,
      title: priceItem.name,
      unit: priceItem.unit,
      quantity,
      price,
      total: round(price * quantity, 2),
    })
  }

  const tasks: DraftTask[] = template.tasks.map((task) => ({
    title: task.title,
    ...(task.type !== undefined ? { type: task.type } : {}),
    estimateMinutes: task.estimateMinutes,
    dependsOn: [...task.dependsOn],
  }))

  return { works, tasks, problems }
}
