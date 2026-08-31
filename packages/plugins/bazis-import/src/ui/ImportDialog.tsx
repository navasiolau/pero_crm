"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { DraftProduct, DraftTask, DraftWork, ImportDraft, ResolvedNeed } from "../parser/types"
import { UNIVERSAL_LABEL, UNIVERSAL_TYPE, type BazisSettings, type MaterialMapEntry } from "../settings"
import { validateDag } from "../templates"
import type { ImportFileItem, MaterialOption, PriceItemOption } from "./api"
import {
  fetchImportFiles,
  fetchPriceItems,
  fetchSettings,
  postApply,
  postExpand,
  postPreview,
  putMaterialMap,
} from "./api"
import { MaterialSelect } from "./MaterialSelect"
import { plural } from "./plural"
import { btnGhostSm, btnOutline, btnPrimary, inputCls } from "./styles"
import { moveTask, removeTask } from "./task-reorder"

type Step = "source" | "confirm" | "success"

const round2 = (value: number) => Math.round(value * 100) / 100

const normName = (value: string) => value.trim().toLowerCase()

/** Несмапленная позиция по включённым изделиям (строка блока «Материалы и склад»). */
interface UnmappedRow {
  bazisName: string
  bazisCode?: string
  unit: string
  qty: number
  samples: string[]
}

const unmappedKey = (row: { bazisName: string; bazisCode?: string; unit: string }) =>
  `${normName(row.bazisName)} ${row.bazisCode ?? ""} ${row.unit}`

/** Совпадает ли потребность с строкой несмапленной (как resolveNeeds: имя + код). */
function needMatchesRow(need: ResolvedNeed, row: UnmappedRow): boolean {
  if (normName(need.bazisName) !== normName(row.bazisName)) return false
  if (!row.bazisCode) return true
  return (need.bazisCode ?? "").trim() === row.bazisCode.trim()
}

// Модал импорта: шаг «Источник» (файл с диска / вложение проекта) →
// шаг «Подтверждение» (сводка + правка драфта: типы изделий, работы,
// задачи) → «Успех».
// Своя разметка на Tailwind (fixed overlay) — shadcn Dialog пакету недоступен.
// Список вложений проекта грузится при открытии диалога (монтировании):
// кнопка-родитель держит только проверку прав, иначе список устаревает.
export function ImportDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("source")
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [numbers, setNumbers] = useState<string[]>([])
  const [createdCounts, setCreatedCounts] = useState({ works: 0, tasks: 0, materials: 0 })
  // null — список ещё грузится; ошибка загрузки не критична → пустой список.
  const [files, setFiles] = useState<ImportFileItem[] | null>(null)

  // Этап B2: настройки (типы изделий) и прайс для редакторов работ.
  const [settings, setSettings] = useState<BazisSettings | null>(null)
  const [priceItems, setPriceItems] = useState<PriceItemOption[]>([])
  // Ключ раскрытого изделия (аккордеон «Работы и задачи») — при 20+
  // изделиях постоянные таблицы под каждым нечитаемы.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // Пересчёт изделия по /expand: busy на строке, правки других не трогаем.
  const [expandBusyKeys, setExpandBusyKeys] = useState<Set<string>>(new Set())
  const [addWorkItemId, setAddWorkItemId] = useState("")
  // Сохранение соответствия материала (PUT settings/material-map) по строкам.
  const [mapBusyKeys, setMapBusyKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void fetchImportFiles(projectId).then((result) => {
      if (cancelled) return
      setFiles(result.ok ? result.files : [])
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Настройки и прайс нужны только на шаге подтверждения.
  useEffect(() => {
    if (step !== "confirm" || settings !== null) return
    let cancelled = false
    void Promise.all([fetchSettings(), fetchPriceItems()]).then(
      ([settingsResult, pricesResult]) => {
        if (cancelled) return
        if (settingsResult.ok) setSettings(settingsResult.settings)
        if (pricesResult.ok) setPriceItems(pricesResult.items)
      },
    )
    return () => {
      cancelled = true
    }
  }, [step, settings])

  async function runPreview(input: {
    xml?: string
    fileName?: string
    fileId?: string
  }) {
    setBusy(true)
    setError(null)
    try {
      const result = await postPreview({ projectId, ...input })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDraft(result.draft)
      setExpandedKey(null)
      setStep("confirm")
    } finally {
      setBusy(false)
    }
  }

  function pickFile(file: File) {
    const name = file.name.toLowerCase()
    if (!name.endsWith(".xml") && !name.endsWith(".json")) {
      setError("Нужен XML-файл спецификации Базис-Мебельщик (.xml)")
      return
    }
    void file
      .text()
      .then((xml) => runPreview({ xml, fileName: file.name }))
      .catch(() => setError("Не удалось прочитать файл"))
  }

  function updateProduct(key: string, patch: Partial<DraftProduct>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            products: current.products.map((product) =>
              product.key === key ? { ...product, ...patch } : product,
            ),
          }
        : current,
    )
  }

  // Смена типа изделия: пересчёт работ/задач через /expand. При ошибке
  // откатываем тип и оставляем прежние работы/задачи.
  async function changeProductType(product: DraftProduct, type: string) {
    const previousType = product.type ?? UNIVERSAL_TYPE
    if (type === previousType) return
    updateProduct(product.key, { type })
    setExpandBusyKeys((current) => new Set(current).add(product.key))
    try {
      const result = await postExpand({
        title: product.title,
        techData: product.techData,
        type,
      })
      if (!result.ok) {
        updateProduct(product.key, { type: previousType })
        toast.error(result.error)
        return
      }
      updateProduct(product.key, {
        type: result.type,
        typeMatched: result.typeMatched,
        works: result.works,
        tasks: result.tasks,
        problems: result.problems,
      })
    } finally {
      setExpandBusyKeys((current) => {
        const next = new Set(current)
        next.delete(product.key)
        return next
      })
    }
  }

  // --- редактор работ изделия ------------------------------------------------

  function updateWork(product: DraftProduct, index: number, patch: Partial<DraftWork>) {
    const works = (product.works ?? []).map((work, i) => {
      if (i !== index) return work
      const next = { ...work, ...patch }
      next.total = round2(next.price * next.quantity)
      return next
    })
    updateProduct(product.key, { works })
  }

  function addWork(product: DraftProduct) {
    const item = priceItems.find((priceItem) => priceItem.id === addWorkItemId)
    if (!item) return
    const work: DraftWork = {
      priceItemId: item.id,
      title: item.name,
      unit: item.unit,
      quantity: 1,
      price: item.price,
      total: round2(item.price),
    }
    updateProduct(product.key, { works: [...(product.works ?? []), work] })
    setAddWorkItemId("")
  }

  // --- редактор задач изделия ------------------------------------------------

  function updateTask(product: DraftProduct, index: number, patch: Partial<DraftTask>) {
    const tasks = (product.tasks ?? []).map((task, i) =>
      i === index ? { ...task, ...patch } : task,
    )
    updateProduct(product.key, { tasks })
  }

  // --- маппинг материалов (этап C) -------------------------------------------

  // Выбор номенклатуры для несмапленной позиции: сохраняем соответствие
  // (мердж на сервере), затем локально проставляем materialId всем
  // совпадающим потребностям драфта — блок «Не распознано» пересчитается сам.
  async function mapNeed(row: UnmappedRow, material: MaterialOption) {
    const key = unmappedKey(row)
    setMapBusyKeys((current) => new Set(current).add(key))
    try {
      const entry: MaterialMapEntry = {
        bazisName: row.bazisName,
        ...(row.bazisCode ? { bazisCode: row.bazisCode } : {}),
        materialId: material.id,
      }
      const result = await putMaterialMap([entry])
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDraft((current) =>
        current
          ? {
              ...current,
              products: current.products.map((product) => ({
                ...product,
                materials: (product.materials ?? []).map((need) =>
                  needMatchesRow(need, row)
                    ? { ...need, materialId: material.id, materialName: material.name }
                    : need,
                ),
              })),
            }
          : current,
      )
      setSettings((current) =>
        current ? { ...current, materialMap: result.materialMap } : current,
      )
      toast.success(`«${row.bazisName}» → ${material.name}`)
    } finally {
      setMapBusyKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  async function apply() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const result = await postApply({
        projectId,
        draft,
        fileName: draft.source.fileName,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      setNumbers(result.numbers)
      setCreatedCounts({
        works: result.workIds.length,
        tasks: result.taskIds.length,
        materials: result.materialsCount,
      })
      setStep("success")
      toast.success(
        `Импортировано: ${result.numbers.length} ${plural(result.numbers.length, "изделие", "изделия", "изделий")}`,
      )
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const included = draft ? draft.products.filter((product) => !product.excluded) : []
  const includedCount = included.length

  // Сводка по работам/задачам включённых изделий.
  const worksTotal = round2(
    included.reduce(
      (sum, product) =>
        sum + (product.works ?? []).reduce((workSum, work) => workSum + work.total, 0),
      0,
    ),
  )
  const tasksCount = included.reduce(
    (sum, product) => sum + (product.tasks ?? []).length,
    0,
  )

  // DAG-проверка задач на лету: любая ошибка блокирует «Применить».
  const dagErrors = useMemo(() => {
    const map = new Map<string, string>()
    for (const product of draft?.products ?? []) {
      const problem = validateDag(product.tasks ?? [])
      if (problem) map.set(product.key, problem)
    }
    return map
  }, [draft])
  const hasDagError = dagErrors.size > 0

  // Несмапленные позиции по включённым изделиям: группировка по
  // (имя+код+единица), кол-во — сумма по драфту, samples — 1-2 изделия.
  const unmapped = useMemo(() => {
    const map = new Map<string, UnmappedRow>()
    for (const product of (draft?.products ?? []).filter((p) => !p.excluded)) {
      for (const need of product.materials ?? []) {
        if (need.materialId) continue
        const row: UnmappedRow = {
          bazisName: need.bazisName,
          ...(need.bazisCode !== undefined ? { bazisCode: need.bazisCode } : {}),
          unit: need.unit,
          qty: need.qty,
          samples: [product.title],
        }
        const key = unmappedKey(row)
        const existing = map.get(key)
        if (existing) {
          existing.qty += need.qty
          if (existing.samples.length < 2 && !existing.samples.includes(product.title)) {
            existing.samples.push(product.title)
          }
        } else {
          map.set(key, row)
        }
      }
    }
    return [...map.values()]
  }, [draft])
  const hasAnyNeeds = included.some((product) => (product.materials?.length ?? 0) > 0)

  // Варианты типа для селекта: шаблоны из настроек + universal (если его нет).
  const typeOptions = useMemo(() => {
    const options = (settings?.productTemplates ?? []).map((template) => ({
      type: template.type,
      label: template.label,
    }))
    if (!options.some((option) => option.type === UNIVERSAL_TYPE)) {
      options.unshift({ type: UNIVERSAL_TYPE, label: UNIVERSAL_LABEL })
    }
    return options
  }, [settings])

  // Типы, для которых есть шаблон. Распознанный классификатором тип без
  // шаблона показываем в селекте отдельной опцией + бейдж «нет шаблона»
  // (работы/задачи для него разворачиваются по «Универсальному»).
  const templateTypes = useMemo(
    () => new Set(typeOptions.map((option) => option.type)),
    [typeOptions],
  )

  function optionsForProduct(product: DraftProduct) {
    if (!product.type || templateTypes.has(product.type)) return typeOptions
    const rule = settings?.classifierRules.find((r) => r.type === product.type)
    return [...typeOptions, { type: product.type, label: rule?.label ?? product.type }]
  }

  // Чипы материалов: листовые (м²) по убыванию расхода + контрольная сумма.
  const materialsM2 = draft
    ? draft.totals.materials
        .filter((material) => material.unit === "m2")
        .sort((a, b) => b.qty - a.qty)
    : []
  const totalM2 = materialsM2.reduce((sum, material) => sum + material.qty, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-6xl flex-col rounded-xl border bg-card p-6 text-card-foreground shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              Импорт из Базис-Мебельщик
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === "source"
                ? "Выберите XML-файл спецификации"
                : step === "confirm"
                  ? "Проверьте состав изделий перед созданием"
                  : "Импорт завершён"}
            </p>
          </div>
          <button
            type="button"
            className={btnGhostSm}
            onClick={onClose}
            disabled={busy}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {step === "source" ? (
            <div className="flex flex-col gap-4">
              <label
                tabIndex={0}
                className={`flex min-h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground transition-colors outline-none focus-visible:border-ring ${
                  dragOver
                    ? "border-primary bg-primary/5 text-foreground"
                    : "hover:border-primary/50 hover:bg-accent/40"
                } ${busy ? "pointer-events-none opacity-60" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOver(false)
                  const file = event.dataTransfer.files?.[0]
                  if (file) pickFile(file)
                }}
                onPaste={(event) => {
                  const file = event.clipboardData?.files?.[0]
                  if (file) {
                    event.preventDefault()
                    pickFile(file)
                  }
                }}
              >
                <span className="text-2xl" aria-hidden>
                  ⇪
                </span>
                {busy
                  ? "Распознаём…"
                  : dragOver
                    ? "Отпустите файл"
                    : "Перетащите XML, нажмите для выбора или вставьте из буфера (Ctrl+V)"}
                <input
                  type="file"
                  accept=".xml,.json,text/xml"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) pickFile(file)
                    event.target.value = ""
                  }}
                />
              </label>

              {files === null ? (
                <p className="text-sm text-muted-foreground">
                  Загрузка вложений…
                </p>
              ) : files.length > 0 ? (
                <div>
                  <div className="mb-2 text-sm font-medium">
                    Или выберите вложение проекта:
                  </div>
                  <ul className="flex flex-col gap-1">
                    {files.map((file) => (
                      <li key={file.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runPreview({ fileId: file.id })}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                        >
                          <span className="truncate">{file.fileName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {new Date(file.createdAt).toLocaleString("ru-RU")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "confirm" && draft ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  Распознано: {draft.products.length}{" "}
                  {plural(draft.products.length, "изделие", "изделия", "изделий")}
                </span>
                {draft.source.fileName ? (
                  <span className="text-muted-foreground">
                    из «{draft.source.fileName}»
                  </span>
                ) : null}
                <span className="rounded-full border px-2.5 py-1 text-xs">
                  Работ на: {worksTotal.toFixed(2)} BYN
                </span>
                <span className="rounded-full border px-2.5 py-1 text-xs">
                  Задач: {tasksCount}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {materialsM2.slice(0, 4).map((material) => (
                  <span
                    key={`${material.name}|${material.thicknessMm ?? ""}`}
                    className="rounded-full border px-2.5 py-1 text-xs"
                  >
                    {material.name} — {material.qty.toFixed(2)} м²
                  </span>
                ))}
                {materialsM2.length > 0 ? (
                  <span className="rounded-full border px-2.5 py-1 text-xs">
                    Всего листовых: {totalM2.toFixed(2)} м²
                  </span>
                ) : null}
                {draft.totals.edging.length > 0 ? (
                  <span className="rounded-full border px-2.5 py-1 text-xs">
                    Кромка —{" "}
                    {draft.totals.edging
                      .reduce((sum, edge) => sum + edge.lengthM, 0)
                      .toFixed(1)}{" "}
                    м.пог
                  </span>
                ) : null}
                {draft.totals.fittings.length > 0 ? (
                  <span className="rounded-full border px-2.5 py-1 text-xs">
                    Фурнитура — {draft.totals.fittings.length} поз. /{" "}
                    {draft.totals.fittings.reduce(
                      (sum, fitting) => sum + fitting.qty,
                      0,
                    )}{" "}
                    шт
                  </span>
                ) : null}
                {draft.totals.profiles.length > 0 ? (
                  <span className="rounded-full border px-2.5 py-1 text-xs">
                    Профили —{" "}
                    {draft.totals.profiles
                      .reduce((sum, profile) => sum + profile.lengthM, 0)
                      .toFixed(1)}{" "}
                    м.пог
                  </span>
                ) : null}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1 font-medium" aria-label="Работы и задачи" />
                    <th className="px-2 py-1 font-medium" aria-label="Включить" />
                    <th className="px-2 py-1 font-medium">Название</th>
                    <th className="px-2 py-1 font-medium">Тип</th>
                    <th className="px-2 py-1 font-medium">Габариты, мм</th>
                    <th className="px-2 py-1 font-medium">Состав</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.products.map((product) => {
                    const panelsQty = product.techData.panels.reduce(
                      (sum, panel) => sum + panel.qty,
                      0,
                    )
                    const fittingsQty = product.techData.fittings.reduce(
                      (sum, fitting) => sum + fitting.qty,
                      0,
                    )
                    const expanded = expandedKey === product.key
                    const expandBusy = expandBusyKeys.has(product.key)
                    const works = product.works ?? []
                    const tasks = product.tasks ?? []
                    const productWorksTotal = round2(
                      works.reduce((sum, work) => sum + work.total, 0),
                    )
                    const dagError = dagErrors.get(product.key)
                    return [
                      <tr
                        key={product.key}
                        className={`border-b ${
                          product.excluded ? "opacity-50" : ""
                        } ${expanded ? "bg-muted/40" : ""}`}
                      >
                        <td className="px-2 py-1 align-middle">
                          <button
                            type="button"
                            className={btnGhostSm}
                            onClick={() =>
                              setExpandedKey(expanded ? null : product.key)
                            }
                            aria-label="Работы и задачи"
                            title="Работы и задачи"
                          >
                            {expanded ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="px-2 py-1 align-middle">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={!product.excluded}
                            onChange={(event) =>
                              updateProduct(product.key, {
                                excluded: !event.target.checked,
                              })
                            }
                            aria-label="Включить в импорт"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className={inputCls}
                            value={product.title}
                            onChange={(event) =>
                              updateProduct(product.key, {
                                title: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-2">
                            <select
                              className={`${inputCls} w-44`}
                              value={product.type ?? UNIVERSAL_TYPE}
                              disabled={expandBusy || product.excluded === true}
                              onChange={(event) =>
                                void changeProductType(product, event.target.value)
                              }
                            >
                              {optionsForProduct(product).map((option) => (
                                <option key={option.type} value={option.type}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {expandBusy ? (
                              <span className="text-xs text-muted-foreground">…</span>
                            ) : product.typeMatched === false ? (
                              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs whitespace-nowrap">
                                не распознан
                              </span>
                            ) : product.type && !templateTypes.has(product.type) ? (
                              <span
                                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs whitespace-nowrap"
                                title="Для этого типа нет шаблона — применён «Универсальный»"
                              >
                                нет шаблона
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                          {product.dims?.w && product.dims?.h && product.dims?.d
                            ? `${Math.round(product.dims.w)}×${Math.round(product.dims.h)}×${Math.round(product.dims.d)}`
                            : "—"}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                          {panelsQty} пан. · {fittingsQty} фурн.
                        </td>
                      </tr>,
                      expanded ? (
                        <tr key={`${product.key}:detail`} className="border-b">
                          <td colSpan={6} className="bg-muted/20 px-4 py-3">
                            <div className="flex flex-col gap-4">
                              {(product.problems ?? []).length > 0 ? (
                                <ul className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                                  {(product.problems ?? []).map((problem, index) => (
                                    <li key={index}>⚠ {problem}</li>
                                  ))}
                                </ul>
                              ) : null}

                              <div className="flex flex-col gap-2">
                                <div className="text-sm font-medium">
                                  Работы{" "}
                                  <span className="font-normal text-muted-foreground">
                                    (итого: {productWorksTotal.toFixed(2)} BYN)
                                  </span>
                                </div>
                                {works.length > 0 ? (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b text-left text-muted-foreground">
                                        <th className="px-2 py-1 font-medium">Расценка</th>
                                        <th className="px-2 py-1 font-medium">Кол-во</th>
                                        <th className="px-2 py-1 font-medium">Ед.</th>
                                        <th className="px-2 py-1 font-medium">Цена, BYN</th>
                                        <th className="px-2 py-1 font-medium">Сумма, BYN</th>
                                        <th className="px-2 py-1 font-medium" aria-label="Удалить" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {works.map((work, workIndex) => (
                                        <tr key={workIndex} className="border-b last:border-0">
                                          <td className="px-2 py-1">{work.title}</td>
                                          <td className="px-2 py-1">
                                            <input
                                              type="number"
                                              min={0}
                                              step="0.01"
                                              className={`${inputCls} w-24`}
                                              value={work.quantity}
                                              onChange={(event) => {
                                                const quantity = Number(event.target.value)
                                                if (!Number.isFinite(quantity)) return
                                                updateWork(product, workIndex, { quantity })
                                              }}
                                            />
                                          </td>
                                          <td className="px-2 py-1 text-muted-foreground">
                                            {work.unit}
                                          </td>
                                          <td className="px-2 py-1 text-muted-foreground">
                                            {work.price.toFixed(2)}
                                          </td>
                                          <td className="px-2 py-1">
                                            {work.total.toFixed(2)}
                                          </td>
                                          <td className="px-2 py-1">
                                            <button
                                              type="button"
                                              className={btnGhostSm}
                                              aria-label="Удалить работу"
                                              title="Удалить"
                                              onClick={() =>
                                                updateProduct(product.key, {
                                                  works: works.filter(
                                                    (_, i) => i !== workIndex,
                                                  ),
                                                })
                                              }
                                            >
                                              ✕
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="text-sm text-muted-foreground">
                                    Работ нет.
                                  </p>
                                )}
                                <div className="flex items-center gap-2">
                                  <select
                                    className={`${inputCls} max-w-72`}
                                    value={addWorkItemId}
                                    onChange={(event) =>
                                      setAddWorkItemId(event.target.value)
                                    }
                                  >
                                    <option value="">— выберите расценку —</option>
                                    {priceItems.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name} — {item.price} BYN/{item.unit}
                                        {item.active ? "" : " (неактивна)"}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className={btnOutline}
                                    disabled={addWorkItemId === ""}
                                    onClick={() => addWork(product)}
                                  >
                                    Добавить работу
                                  </button>
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                <div className="text-sm font-medium">
                                  Задачи-черновики
                                </div>
                                {tasks.length > 0 ? (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b text-left text-muted-foreground">
                                        <th className="px-2 py-1 font-medium" aria-label="Порядок" />
                                        <th className="px-2 py-1 font-medium">Название</th>
                                        <th className="px-2 py-1 font-medium">Оценка, мин</th>
                                        <th className="px-2 py-1 font-medium">Зависит от</th>
                                        <th className="px-2 py-1 font-medium" aria-label="Удалить" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tasks.map((task, taskIndex) => (
                                        <tr key={taskIndex} className="border-b last:border-0">
                                          <td className="px-2 py-1 whitespace-nowrap">
                                            <button
                                              type="button"
                                              className={btnGhostSm}
                                              disabled={taskIndex === 0}
                                              aria-label="Выше"
                                              onClick={() =>
                                                updateProduct(product.key, {
                                                  tasks: moveTask(tasks, taskIndex, taskIndex - 1),
                                                })
                                              }
                                            >
                                              ↑
                                            </button>
                                            <button
                                              type="button"
                                              className={btnGhostSm}
                                              disabled={taskIndex === tasks.length - 1}
                                              aria-label="Ниже"
                                              onClick={() =>
                                                updateProduct(product.key, {
                                                  tasks: moveTask(tasks, taskIndex, taskIndex + 1),
                                                })
                                              }
                                            >
                                              ↓
                                            </button>
                                          </td>
                                          <td className="px-2 py-1">
                                            <input
                                              className={inputCls}
                                              value={task.title}
                                              onChange={(event) =>
                                                updateTask(product, taskIndex, {
                                                  title: event.target.value,
                                                })
                                              }
                                            />
                                          </td>
                                          <td className="px-2 py-1">
                                            <input
                                              type="number"
                                              min={1}
                                              className={`${inputCls} w-20`}
                                              value={task.estimateMinutes}
                                              onChange={(event) => {
                                                const estimateMinutes = Number(event.target.value)
                                                if (!Number.isFinite(estimateMinutes)) return
                                                updateTask(product, taskIndex, { estimateMinutes })
                                              }}
                                            />
                                          </td>
                                          <td className="px-2 py-1">
                                            <details className="relative">
                                              <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                                                {task.dependsOn.length > 0
                                                  ? task.dependsOn
                                                      .map(
                                                        (dep) =>
                                                          `${dep + 1}. ${tasks[dep]?.title ?? "?"}`,
                                                      )
                                                      .join(", ")
                                                  : "нет"}
                                              </summary>
                                              <div className="absolute z-10 mt-1 flex w-56 flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
                                                {tasks.map((other, otherIndex) =>
                                                  otherIndex === taskIndex ? null : (
                                                    <label
                                                      key={otherIndex}
                                                      className="flex items-center gap-2 text-xs"
                                                    >
                                                      <input
                                                        type="checkbox"
                                                        className="size-3.5 accent-primary"
                                                        checked={task.dependsOn.includes(otherIndex)}
                                                        onChange={(event) =>
                                                          updateTask(product, taskIndex, {
                                                            dependsOn: event.target.checked
                                                              ? [...task.dependsOn, otherIndex].sort(
                                                                  (a, b) => a - b,
                                                                )
                                                              : task.dependsOn.filter(
                                                                  (dep) => dep !== otherIndex,
                                                                ),
                                                          })
                                                        }
                                                      />
                                                      {otherIndex + 1}. {other.title || "без названия"}
                                                    </label>
                                                  ),
                                                )}
                                              </div>
                                            </details>
                                          </td>
                                          <td className="px-2 py-1">
                                            <button
                                              type="button"
                                              className={btnGhostSm}
                                              aria-label="Удалить задачу"
                                              title="Удалить"
                                              onClick={() =>
                                                updateProduct(product.key, {
                                                  tasks: removeTask(tasks, taskIndex),
                                                })
                                              }
                                            >
                                              ✕
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="text-sm text-muted-foreground">
                                    Задач нет.
                                  </p>
                                )}
                                {dagError ? (
                                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    {dagError}
                                  </div>
                                ) : null}
                                <div>
                                  <button
                                    type="button"
                                    className={btnOutline}
                                    onClick={() =>
                                      updateProduct(product.key, {
                                        tasks: [
                                          ...tasks,
                                          {
                                            title: "Новая задача",
                                            estimateMinutes: 30,
                                            dependsOn:
                                              tasks.length > 0 ? [tasks.length - 1] : [],
                                          },
                                        ],
                                      })
                                    }
                                  >
                                    Добавить задачу
                                  </button>
                                </div>
                              </div>

                              {(product.materials ?? []).length > 0 ? (
                                <div className="flex flex-col gap-2">
                                  <div className="text-sm font-medium">
                                    Материалы{" "}
                                    <span className="font-normal text-muted-foreground">
                                      (потребность склада)
                                    </span>
                                  </div>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b text-left text-muted-foreground">
                                        <th className="px-2 py-1 font-medium">Позиция Базиса</th>
                                        <th className="px-2 py-1 font-medium">Кол-во</th>
                                        <th className="px-2 py-1 font-medium">Ед.</th>
                                        <th className="px-2 py-1 font-medium">Номенклатура</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(product.materials ?? []).map((need, needIndex) => (
                                        <tr key={needIndex} className="border-b last:border-0">
                                          <td className="px-2 py-1">
                                            {need.bazisName}
                                            {need.bazisCode ? (
                                              <span className="text-muted-foreground">
                                                {" "}
                                                (код {need.bazisCode})
                                              </span>
                                            ) : null}
                                          </td>
                                          <td className="px-2 py-1 whitespace-nowrap">
                                            {need.qty}
                                          </td>
                                          <td className="px-2 py-1 text-muted-foreground">
                                            {need.unit}
                                          </td>
                                          <td className="px-2 py-1">
                                            {need.materialId ? (
                                              need.materialName ?? need.materialId
                                            ) : (
                                              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs whitespace-nowrap">
                                                — не смаплено
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ]
                  })}
                </tbody>
              </table>

              {hasAnyNeeds ? (
                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    Материалы и склад
                  </div>
                  <div className="flex flex-col gap-2 px-3 py-2">
                    {unmapped.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Все позиции смаплены на номенклатуру склада — потребность
                        будет создана при применении.
                      </p>
                    ) : (
                      <>
                        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                          Не распознано позиций: {unmapped.length}. Выберите
                          материал склада — соответствие сохранится в настройках
                          плагина и сработает при следующих импортах.
                        </p>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="px-2 py-1 font-medium">Позиция Базиса</th>
                              <th className="px-2 py-1 font-medium">Кол-во</th>
                              <th className="px-2 py-1 font-medium">Ед.</th>
                              <th className="px-2 py-1 font-medium">Материал склада</th>
                            </tr>
                          </thead>
                          <tbody>
                            {unmapped.map((row) => {
                              const key = unmappedKey(row)
                              return (
                                <tr key={key} className="border-b last:border-0">
                                  <td className="px-2 py-1">
                                    {row.bazisName}
                                    {row.bazisCode ? (
                                      <span className="text-muted-foreground">
                                        {" "}
                                        (код {row.bazisCode})
                                      </span>
                                    ) : null}
                                    <div className="text-xs text-muted-foreground">
                                      {row.samples.join(", ")}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {round2(row.qty)}
                                  </td>
                                  <td className="px-2 py-1 text-muted-foreground">
                                    {row.unit}
                                  </td>
                                  <td className="px-2 py-1">
                                    <MaterialSelect
                                      disabled={mapBusyKeys.has(key)}
                                      createDefaults={{ name: row.bazisName, unit: row.unit }}
                                      onPick={(material) => void mapNeed(row, material)}
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "success" ? (
            <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
              Создано: {numbers.length}{" "}
              {plural(numbers.length, "изделие", "изделия", "изделий")},{" "}
              {createdCounts.works}{" "}
              {plural(createdCounts.works, "работа", "работы", "работ")},{" "}
              {createdCounts.tasks}{" "}
              {plural(
                createdCounts.tasks,
                "задача-черновик",
                "задачи-черновика",
                "задач-черновиков",
              )}
              {createdCounts.materials > 0 ? (
                <>
                  , потребность: {createdCounts.materials}{" "}
                  {plural(
                    createdCounts.materials,
                    "позиция материалов",
                    "позиции материалов",
                    "позиций материалов",
                  )}
                </>
              ) : null}
              {numbers.length > 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  (номера {numbers.join(", ")})
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t pt-4">
          {step === "source" ? (
            <button
              type="button"
              className={btnOutline}
              onClick={onClose}
              disabled={busy}
            >
              Отмена
            </button>
          ) : null}
          {step === "confirm" ? (
            <>
              {includedCount === 0 ? (
                <span className="mr-auto text-sm text-muted-foreground">
                  Все изделия исключены — нечего импортировать
                </span>
              ) : null}
              {hasDagError ? (
                <span className="mr-auto text-sm text-destructive">
                  Есть цикл в зависимостях задач — исправьте перед применением
                </span>
              ) : null}
              {unmapped.length > 0 ? (
                <span className="mr-auto text-sm text-amber-600 dark:text-amber-500">
                  {unmapped.length}{" "}
                  {plural(unmapped.length, "позиция", "позиции", "позиций")} без
                  номенклатуры — будут пропущены
                </span>
              ) : null}
              <button
                type="button"
                className={btnOutline}
                onClick={onClose}
                disabled={busy}
              >
                Отмена
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void apply()}
                disabled={busy || includedCount === 0 || hasDagError}
                title={
                  hasDagError
                    ? "Исправьте зависимости задач"
                    : includedCount === 0
                      ? "Все изделия исключены из импорта"
                      : undefined
                }
              >
                {busy
                  ? "Применяем…"
                  : `Применить (${includedCount})`}
              </button>
            </>
          ) : null}
          {step === "success" ? (
            <button type="button" className={btnPrimary} onClick={onClose}>
              Закрыть
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
