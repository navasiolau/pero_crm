// Клиентские обёртки над REST /api/bazis-import (session auth, офисные роли).
// Контракты ответов — см. apps/web/src/app/api/bazis-import/*/route.ts.

import type { DraftQuantities, DraftTask, DraftWork, ImportDraft, TechData } from "../parser/types"
import type { UnmappedMaterialSummary } from "../materials"
import type { BazisSettings, MaterialMapEntry } from "../settings"

/** Вложение проекта, пригодное для импорта (XML / .pero.json). */
export interface ImportFileItem {
  id: string
  fileName: string
  createdAt: string
}

/** Строка истории импортов (пакет). */
export interface ImportBatchItem {
  id: string
  fileName: string | null
  createdAt: string
  revertedAt: string | null
  createdById: string | null
  createdByName: string | null
  productsCount: number
  draftProductsCount: number
  quantities: DraftQuantities | null
}

export interface ApiFailure {
  ok: false
  status: number
  error: string
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => ({}))
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)
    : {}
}

function failure(
  status: number,
  data: Record<string, unknown>,
  fallback: string,
): ApiFailure {
  return {
    ok: false,
    status,
    error: typeof data.error === "string" ? data.error : fallback,
  }
}

export async function fetchImportFiles(
  projectId: string,
): Promise<
  { ok: true; status: number; files: ImportFileItem[] } | ApiFailure
> {
  const response = await fetch(
    `/api/bazis-import/files?projectId=${encodeURIComponent(projectId)}`,
  )
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось загрузить список файлов")
  }
  return { ok: true, status: response.status, files: data.files as ImportFileItem[] }
}

export async function fetchImportBatches(
  projectId: string,
): Promise<
  { ok: true; status: number; batches: ImportBatchItem[] } | ApiFailure
> {
  const response = await fetch(
    `/api/bazis-import/batches?projectId=${encodeURIComponent(projectId)}`,
  )
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось загрузить историю импортов")
  }
  return {
    ok: true,
    status: response.status,
    batches: data.batches as ImportBatchItem[],
  }
}

export async function postPreview(input: {
  projectId: string
  xml?: string
  fileName?: string
  fileId?: string
}): Promise<
  { ok: true; draft: ImportDraft; unmappedMaterials: UnmappedMaterialSummary[] } | ApiFailure
> {
  const response = await fetch("/api/bazis-import/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось разобрать файл")
  }
  return {
    ok: true,
    draft: data.draft as ImportDraft,
    unmappedMaterials: (data.unmappedMaterials as UnmappedMaterialSummary[] | undefined) ?? [],
  }
}

export async function postApply(input: {
  projectId: string
  draft: ImportDraft
  fileName?: string
}): Promise<
  | {
      ok: true
      batchId: string
      productIds: string[]
      numbers: string[]
      workIds: string[]
      taskIds: string[]
      materialsCount: number
    }
  | ApiFailure
> {
  const response = await fetch("/api/bazis-import/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось применить импорт")
  }
  return {
    ok: true,
    batchId: data.batchId as string,
    productIds: data.productIds as string[],
    numbers: data.numbers as string[],
    workIds: (data.workIds as string[] | undefined) ?? [],
    taskIds: (data.taskIds as string[] | undefined) ?? [],
    materialsCount: (data.materialsCount as number | undefined) ?? 0,
  }
}

export async function postRevert(
  batchId: string,
): Promise<{ ok: true } | ApiFailure> {
  const response = await fetch("/api/bazis-import/revert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId }),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось откатить импорт")
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Этап B2: настройки, прайс, пересчёт изделия
// ---------------------------------------------------------------------------

/** Расценка прайса для селектов (GET /price-items). */
export interface PriceItemOption {
  id: string
  name: string
  unit: string
  price: number
  category: string | null
  active: boolean
}

export async function fetchSettings(): Promise<
  { ok: true; settings: BazisSettings; saved: boolean } | ApiFailure
> {
  const response = await fetch("/api/bazis-import/settings")
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось загрузить настройки")
  }
  return {
    ok: true,
    settings: data.settings as BazisSettings,
    saved: data.saved === true,
  }
}

export async function putSettings(
  settings: BazisSettings,
): Promise<{ ok: true } | ApiFailure> {
  const response = await fetch("/api/bazis-import/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось сохранить настройки")
  }
  return { ok: true }
}

export async function fetchPriceItems(): Promise<
  { ok: true; items: PriceItemOption[] } | ApiFailure
> {
  const response = await fetch("/api/bazis-import/price-items")
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось загрузить прайс")
  }
  return { ok: true, items: data.items as PriceItemOption[] }
}

/** Ответ POST /expand — пересчёт работ/задач изделия под новый тип. */
export interface ExpandResponse {
  type: string
  typeMatched: boolean
  works: DraftWork[]
  tasks: DraftTask[]
  problems: string[]
}

export async function postExpand(input: {
  title: string
  techData: TechData
  type: string
}): Promise<{ ok: true } & ExpandResponse | ApiFailure> {
  const response = await fetch("/api/bazis-import/expand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product: input }),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось пересчитать изделие")
  }
  return {
    ok: true,
    type: data.type as string,
    typeMatched: data.typeMatched === true,
    works: data.works as DraftWork[],
    tasks: data.tasks as DraftTask[],
    problems: data.problems as string[],
  }
}

// ---------------------------------------------------------------------------
// Этап C: номенклатура склада и маппинг материалов
// ---------------------------------------------------------------------------

/** Позиция номенклатуры склада для селектов (GET /materials). */
export interface MaterialOption {
  id: string
  name: string
  unit: string
  sku: string | null
  active: boolean
}

/** Поиск номенклатуры: q — подстрока имени (лимит 50), ids — точные id (до 100). */
export async function fetchMaterials(input?: {
  q?: string
  ids?: string[]
}): Promise<{ ok: true; items: MaterialOption[] } | ApiFailure> {
  const params = new URLSearchParams()
  if (input?.ids && input.ids.length > 0) {
    params.set("ids", input.ids.join(","))
  } else if (input?.q) {
    params.set("q", input.q)
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  const response = await fetch(`/api/bazis-import/materials${suffix}`)
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось загрузить номенклатуру")
  }
  return { ok: true, items: data.items as MaterialOption[] }
}

/** Быстрое создание позиции номенклатуры с экрана маппинга (цена 0 — правит склад). */
export async function createMaterial(input: {
  name: string
  unit: string
}): Promise<{ ok: true; item: MaterialOption } | ApiFailure> {
  const response = await fetch("/api/bazis-import/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось создать материал")
  }
  return { ok: true, item: data.item as MaterialOption }
}

/** Мердж соответствий Базис→номенклатура (A/D/M/ENGINEER; только ключ materialMap). */
export async function putMaterialMap(
  entries: MaterialMapEntry[],
): Promise<{ ok: true; materialMap: MaterialMapEntry[] } | ApiFailure> {
  const response = await fetch("/api/bazis-import/settings/material-map", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  })
  const data = await parseJson(response)
  if (!response.ok || data.ok !== true) {
    return failure(response.status, data, "Не удалось сохранить соответствие")
  }
  return { ok: true, materialMap: data.materialMap as MaterialMapEntry[] }
}
