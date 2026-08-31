"use client"

import { useEffect, useMemo, useState } from "react"
import type { SlotPropsMap } from "@pero/plugin-sdk"
import { toast } from "sonner"

import {
  DEFAULT_SETTINGS,
  type BazisSettings,
  type MaterialMapEntry,
  type ProductTemplate,
  type QtyRule,
} from "../settings"
import { validateDag } from "../templates"
import {
  fetchMaterials,
  fetchPriceItems,
  fetchSettings,
  putSettings,
  type MaterialOption,
  type PriceItemOption,
} from "./api"
import { MaterialSelect } from "./MaterialSelect"
import { btnGhostSm, btnOutline, btnPrimary, inputCls } from "./styles"
import { moveTask, removeTask } from "./task-reorder"

// Страница настроек плагина (слот settings.page): правила классификатора,
// шаблоны работ/задач по типам изделий, маппинг материалов (этап C).
// Чтение/запись — через /api/bazis-import/settings (PUT — только A/D).

/** Правило в режиме редактирования: списки подстрок — текстом через запятую. */
interface RuleDraft {
  type: string
  label: string
  anyText: string
  noneText: string
}

type Section = "rules" | "templates" | "materials"

const QTY_RULE_LABELS: Record<QtyRule, string> = {
  panels_m2: "м² панелей",
  edging_m: "м.пог кромки",
  boxes_count: "ящики, шт",
  panels_count: "панели, шт",
  fixed: "фиксированно",
}

const QTY_RULES_ORDER: QtyRule[] = [
  "panels_m2",
  "edging_m",
  "boxes_count",
  "panels_count",
  "fixed",
]

function splitCsv(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

function rulesToDraft(settings: BazisSettings): RuleDraft[] {
  return settings.classifierRules.map((rule) => ({
    type: rule.type,
    label: rule.label,
    anyText: rule.any.join(", "),
    noneText: (rule.none ?? []).join(", "),
  }))
}

export default function SettingsPage(_props: SlotPropsMap["settings.page"]) {
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saved, setSaved] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>("rules")
  const [rules, setRules] = useState<RuleDraft[]>([])
  const [templates, setTemplates] = useState<ProductTemplate[]>([])
  const [materialMap, setMaterialMap] = useState<BazisSettings["materialMap"]>([])
  const [priceItems, setPriceItems] = useState<PriceItemOption[]>([])
  const [openTemplate, setOpenTemplate] = useState<string | null>(null)
  // Имена номенклатуры для сохранённых соответствий (догружаются по id).
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})
  // Форма добавления соответствия.
  const [newBazisName, setNewBazisName] = useState("")
  const [newBazisCode, setNewBazisCode] = useState("")
  const [newMaterial, setNewMaterial] = useState<MaterialOption | null>(null)

  // Догрузка имён номенклатуры, на которую ссылается маппинг.
  useEffect(() => {
    const missing = materialMap
      .map((entry) => entry.materialId)
      .filter((id) => !(id in materialNames))
    if (missing.length === 0) return
    let cancelled = false
    void fetchMaterials({ ids: missing }).then((result) => {
      if (cancelled || !result.ok) return
      setMaterialNames((current) => {
        const next = { ...current }
        for (const id of missing) {
          next[id] = result.items.find((item) => item.id === id)?.name ?? "⚠ нет в номенклатуре"
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [materialMap, materialNames])

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchSettings(), fetchPriceItems()]).then(
      ([settingsResult, pricesResult]) => {
        if (cancelled) return
        if (!settingsResult.ok) {
          setLoadError(settingsResult.error)
          setLoaded(true)
          return
        }
        applySettings(settingsResult.settings)
        setSaved(settingsResult.saved)
        if (pricesResult.ok) setPriceItems(pricesResult.items)
        setLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applySettings(settings: BazisSettings) {
    setRules(rulesToDraft(settings))
    setTemplates(structuredClone(settings.productTemplates))
    setMaterialMap(structuredClone(settings.materialMap))
  }

  // DAG-ошибки шаблонов на лету: подсветка + блокировка сохранения.
  const dagErrors = useMemo(() => {
    const map = new Map<string, string>()
    for (const template of templates) {
      const problem = validateDag(template.tasks)
      if (problem) map.set(template.type, problem)
    }
    return map
  }, [templates])
  const hasDagError = dagErrors.size > 0

  function buildSettings(): BazisSettings {
    return {
      classifierRules: rules.map((rule) => ({
        type: rule.type.trim(),
        label: rule.label.trim(),
        any: splitCsv(rule.anyText),
        ...(splitCsv(rule.noneText).length > 0
          ? { none: splitCsv(rule.noneText) }
          : {}),
      })),
      productTemplates: templates,
      materialMap,
    }
  }

  async function save(settings?: BazisSettings) {
    setBusy(true)
    setError(null)
    try {
      const result = await putSettings(settings ?? buildSettings())
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return false
      }
      setSaved(true)
      toast.success("Настройки сохранены")
      return true
    } finally {
      setBusy(false)
    }
  }

  async function resetToDefaults() {
    if (
      !window.confirm(
        "Вернуть стартовый набор настроек? Текущие правила и шаблоны будут заменены.",
      )
    ) {
      return
    }
    const defaults = structuredClone(DEFAULT_SETTINGS)
    applySettings(defaults)
    await save(defaults)
  }

  // --- правила классификатора ---------------------------------------------

  function updateRule(index: number, patch: Partial<RuleDraft>) {
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    )
  }

  function moveRule(index: number, delta: -1 | 1) {
    setRules((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item as RuleDraft)
      return next
    })
  }

  // --- шаблоны --------------------------------------------------------------

  function updateTemplate(type: string, patch: Partial<ProductTemplate>) {
    setTemplates((current) =>
      current.map((template) =>
        template.type === type ? { ...template, ...patch } : template,
      ),
    )
  }

  // --- маппинг материалов (этап C) ------------------------------------------
  // Правки сохраняются сразу общим PUT settings (страница доступна только A/D).

  async function saveMaterialMap(next: MaterialMapEntry[]) {
    const savedOk = await save({ ...buildSettings(), materialMap: next })
    if (savedOk) setMaterialMap(next)
  }

  async function addMaterialMapEntry() {
    const bazisName = newBazisName.trim()
    const bazisCode = newBazisCode.trim()
    if (bazisName === "" || !newMaterial) {
      setError("Укажите имя материала Базиса и выберите материал склада")
      return
    }
    const entry: MaterialMapEntry = {
      bazisName,
      ...(bazisCode !== "" ? { bazisCode } : {}),
      materialId: newMaterial.id,
    }
    setMaterialNames((current) => ({ ...current, [newMaterial.id]: newMaterial.name }))
    await saveMaterialMap([...materialMap, entry])
    setNewBazisName("")
    setNewBazisCode("")
    setNewMaterial(null)
  }

  async function removeMaterialMapEntry(index: number) {
    await saveMaterialMap(materialMap.filter((_, i) => i !== index))
  }

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Загрузка настроек…</p>
  }
  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  const sections: { id: Section; label: string }[] = [
    { id: "rules", label: "Правила классификатора" },
    { id: "templates", label: "Шаблоны изделий" },
    { id: "materials", label: "Маппинг материалов" },
  ]

  return (
    <div className="flex flex-col gap-4">
      {!saved ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span>Используется стартовый набор (ещё не сохранён).</span>
          <button
            type="button"
            className={btnOutline}
            disabled={busy}
            onClick={() => void save()}
          >
            Сохранить стартовый набор
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={`rounded-t-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              section === item.id
                ? "border border-b-card bg-card text-foreground -mb-px border-b-transparent"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === "rules" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Порядок = приоритет: первое совпавшее правило побеждает. «Любое из»
            ищется в названии изделия и в деталировке, «ни одно из» — только в
            названии. Если не совпало ничего, изделие получает тип
            «Универсальный».
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-1 font-medium">Тип</th>
                <th className="px-2 py-1 font-medium">Название</th>
                <th className="px-2 py-1 font-medium">Любое из (через запятую)</th>
                <th className="px-2 py-1 font-medium">Ни одно из</th>
                <th className="px-2 py-1 font-medium" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={index} className="border-b last:border-0">
                  <td className="px-2 py-1">
                    <input
                      className={inputCls}
                      value={rule.type}
                      onChange={(event) =>
                        updateRule(index, { type: event.target.value })
                      }
                      placeholder="kitchen_module"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={inputCls}
                      value={rule.label}
                      onChange={(event) =>
                        updateRule(index, { label: event.target.value })
                      }
                      placeholder="Кухонный модуль"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={inputCls}
                      value={rule.anyText}
                      onChange={(event) =>
                        updateRule(index, { anyText: event.target.value })
                      }
                      placeholder="модуль, кухон"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={inputCls}
                      value={rule.noneText}
                      onChange={(event) =>
                        updateRule(index, { noneText: event.target.value })
                      }
                      placeholder="необязательно"
                    />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button
                      type="button"
                      className={btnGhostSm}
                      disabled={index === 0}
                      onClick={() => moveRule(index, -1)}
                      aria-label="Выше"
                      title="Выше (приоритетнее)"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={btnGhostSm}
                      disabled={index === rules.length - 1}
                      onClick={() => moveRule(index, 1)}
                      aria-label="Ниже"
                      title="Ниже"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={btnGhostSm}
                      onClick={() =>
                        setRules((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      aria-label="Удалить правило"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button
              type="button"
              className={btnOutline}
              onClick={() =>
                setRules((current) => [
                  ...current,
                  { type: "", label: "", anyText: "", noneText: "" },
                ])
              }
            >
              Добавить правило
            </button>
          </div>
        </div>
      ) : null}

      {section === "templates" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Работы берут количество из агрегатов изделия (правило × множитель;
            для «фиксированно» множитель — само количество). Задачи создаются
            черновиками, зависимости — по порядку в списке.
          </p>
          {templates.map((template) => {
            const open = openTemplate === template.type
            const dagError = dagErrors.get(template.type)
            return (
              <div key={template.type} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                  onClick={() => setOpenTemplate(open ? null : template.type)}
                >
                  <span className="font-medium">
                    {open ? "▾" : "▸"} {template.label}{" "}
                    <span className="text-muted-foreground">({template.type})</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    работ: {template.works.length} · задач: {template.tasks.length}
                  </span>
                </button>
                {open ? (
                  <div className="flex flex-col gap-4 border-t px-3 py-3">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Название:</span>
                      <input
                        className={`${inputCls} max-w-64`}
                        value={template.label}
                        onChange={(event) =>
                          updateTemplate(template.type, {
                            label: event.target.value,
                          })
                        }
                      />
                    </label>

                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-medium">Работы</div>
                      {template.works.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="px-2 py-1 font-medium">Расценка</th>
                              <th className="px-2 py-1 font-medium">Количество</th>
                              <th className="px-2 py-1 font-medium">Множитель</th>
                              <th className="px-2 py-1 font-medium" aria-label="Удалить" />
                            </tr>
                          </thead>
                          <tbody>
                            {template.works.map((work, workIndex) => (
                              <tr key={workIndex} className="border-b last:border-0">
                                <td className="px-2 py-1">
                                  <select
                                    className={inputCls}
                                    value={work.priceItemId}
                                    onChange={(event) => {
                                      const works = template.works.map((item, i) =>
                                        i === workIndex
                                          ? { ...item, priceItemId: event.target.value }
                                          : item,
                                      )
                                      updateTemplate(template.type, { works })
                                    }}
                                  >
                                    <option value="">— выберите расценку —</option>
                                    {priceItems.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name} — {item.price} BYN/{item.unit}
                                        {item.active ? "" : " (неактивна)"}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-1">
                                  <select
                                    className={inputCls}
                                    value={work.qtyRule}
                                    onChange={(event) => {
                                      const works = template.works.map((item, i) =>
                                        i === workIndex
                                          ? { ...item, qtyRule: event.target.value as QtyRule }
                                          : item,
                                      )
                                      updateTemplate(template.type, { works })
                                    }}
                                  >
                                    {QTY_RULES_ORDER.map((rule) => (
                                      <option key={rule} value={rule}>
                                        {QTY_RULE_LABELS[rule]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className={`${inputCls} w-24`}
                                    value={work.factor ?? 1}
                                    onChange={(event) => {
                                      const factor = Number(event.target.value)
                                      const works = template.works.map((item, i) =>
                                        i === workIndex
                                          ? {
                                              ...item,
                                              factor:
                                                Number.isFinite(factor) && factor > 0
                                                  ? factor
                                                  : undefined,
                                            }
                                          : item,
                                      )
                                      updateTemplate(template.type, { works })
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <button
                                    type="button"
                                    className={btnGhostSm}
                                    aria-label="Удалить работу"
                                    title="Удалить"
                                    onClick={() =>
                                      updateTemplate(template.type, {
                                        works: template.works.filter(
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
                          Работ нет — добавьте первую.
                        </p>
                      )}
                      <div>
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() =>
                            updateTemplate(template.type, {
                              works: [
                                ...template.works,
                                { priceItemId: "", qtyRule: "panels_m2" },
                              ],
                            })
                          }
                        >
                          Добавить работу
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-medium">Задачи</div>
                      {template.tasks.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="px-2 py-1 font-medium" aria-label="Порядок" />
                              <th className="px-2 py-1 font-medium">Название</th>
                              <th className="px-2 py-1 font-medium">Тип</th>
                              <th className="px-2 py-1 font-medium">Оценка, мин</th>
                              <th className="px-2 py-1 font-medium">Зависит от</th>
                              <th className="px-2 py-1 font-medium" aria-label="Удалить" />
                            </tr>
                          </thead>
                          <tbody>
                            {template.tasks.map((task, taskIndex) => (
                              <tr key={taskIndex} className="border-b last:border-0">
                                <td className="px-2 py-1 whitespace-nowrap">
                                  <button
                                    type="button"
                                    className={btnGhostSm}
                                    disabled={taskIndex === 0}
                                    aria-label="Выше"
                                    onClick={() =>
                                      updateTemplate(template.type, {
                                        tasks: moveTask(
                                          template.tasks,
                                          taskIndex,
                                          taskIndex - 1,
                                        ),
                                      })
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className={btnGhostSm}
                                    disabled={taskIndex === template.tasks.length - 1}
                                    aria-label="Ниже"
                                    onClick={() =>
                                      updateTemplate(template.type, {
                                        tasks: moveTask(
                                          template.tasks,
                                          taskIndex,
                                          taskIndex + 1,
                                        ),
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
                                    onChange={(event) => {
                                      const tasks = template.tasks.map((item, i) =>
                                        i === taskIndex
                                          ? { ...item, title: event.target.value }
                                          : item,
                                      )
                                      updateTemplate(template.type, { tasks })
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    className={`${inputCls} w-28`}
                                    value={task.type ?? ""}
                                    placeholder="необяз."
                                    onChange={(event) => {
                                      const value = event.target.value
                                      const tasks = template.tasks.map((item, i) =>
                                        i === taskIndex
                                          ? {
                                              ...item,
                                              ...(value.trim() !== ""
                                                ? { type: value }
                                                : { type: undefined }),
                                            }
                                          : item,
                                      )
                                      updateTemplate(template.type, { tasks })
                                    }}
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
                                      const tasks = template.tasks.map((item, i) =>
                                        i === taskIndex
                                          ? {
                                              ...item,
                                              estimateMinutes: Number.isFinite(estimateMinutes)
                                                ? estimateMinutes
                                                : item.estimateMinutes,
                                            }
                                          : item,
                                      )
                                      updateTemplate(template.type, { tasks })
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
                                                `${dep + 1}. ${template.tasks[dep]?.title ?? "?"}`,
                                            )
                                            .join(", ")
                                        : "нет"}
                                    </summary>
                                    <div className="absolute z-10 mt-1 flex w-56 flex-col gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
                                      {template.tasks.map((other, otherIndex) =>
                                        otherIndex === taskIndex ? null : (
                                          <label
                                            key={otherIndex}
                                            className="flex items-center gap-2 text-xs"
                                          >
                                            <input
                                              type="checkbox"
                                              className="size-3.5 accent-primary"
                                              checked={task.dependsOn.includes(otherIndex)}
                                              onChange={(event) => {
                                                const tasks = template.tasks.map((item, i) =>
                                                  i === taskIndex
                                                    ? {
                                                        ...item,
                                                        dependsOn: event.target.checked
                                                          ? [...item.dependsOn, otherIndex].sort(
                                                              (a, b) => a - b,
                                                            )
                                                          : item.dependsOn.filter(
                                                              (dep) => dep !== otherIndex,
                                                            ),
                                                      }
                                                    : item,
                                                )
                                                updateTemplate(template.type, { tasks })
                                              }}
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
                                      updateTemplate(template.type, {
                                        tasks: removeTask(template.tasks, taskIndex),
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
                          Задач нет — добавьте первую.
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
                            updateTemplate(template.type, {
                              tasks: [
                                ...template.tasks,
                                {
                                  title: "Новая задача",
                                  estimateMinutes: 30,
                                  dependsOn:
                                    template.tasks.length > 0
                                      ? [template.tasks.length - 1]
                                      : [],
                                },
                              ],
                            })
                          }
                        >
                          Добавить задачу
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {section === "materials" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Соответствие позиций Базиса номенклатуре склада: по нему импорт
            создаёт потребность (вкладка «Материалы» изделия). Имя сравнивается
            без регистра; код необязателен — запись с кодом имеет приоритет над
            общей. Несмапленные позиции можно разметить прямо на экране
            подтверждения импорта.
          </p>
          {materialMap.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Материал Базиса</th>
                  <th className="px-2 py-1 font-medium">Код Базиса</th>
                  <th className="px-2 py-1 font-medium">Материал склада</th>
                  <th className="px-2 py-1 font-medium" aria-label="Удалить" />
                </tr>
              </thead>
              <tbody>
                {materialMap.map((entry, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="px-2 py-1">{entry.bazisName}</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {entry.bazisCode ?? "—"}
                    </td>
                    <td className="px-2 py-1">
                      {materialNames[entry.materialId] ?? "…"}
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className={btnGhostSm}
                        disabled={busy}
                        aria-label="Удалить соответствие"
                        title="Удалить"
                        onClick={() => void removeMaterialMapEntry(index)}
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
              Соответствий пока нет — добавьте первое.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <label className="flex min-w-48 flex-col gap-1 text-xs text-muted-foreground">
              Материал Базиса
              <input
                className={inputCls}
                value={newBazisName}
                placeholder="например, МДФ 19 мм"
                onChange={(event) => setNewBazisName(event.target.value)}
              />
            </label>
            <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
              Код (необязательно)
              <input
                className={inputCls}
                value={newBazisCode}
                onChange={(event) => setNewBazisCode(event.target.value)}
              />
            </label>
            <div className="flex min-w-56 flex-col gap-1 text-xs text-muted-foreground">
              Материал склада
              {newMaterial ? (
                <div className="flex h-8 items-center justify-between gap-2 rounded-lg border px-2.5 text-sm text-foreground">
                  <span className="truncate">{newMaterial.name}</span>
                  <button
                    type="button"
                    className={btnGhostSm}
                    aria-label="Сменить материал"
                    title="Сменить"
                    onClick={() => setNewMaterial(null)}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <MaterialSelect
                  createDefaults={{
                    ...(newBazisName.trim() !== "" ? { name: newBazisName.trim() } : {}),
                  }}
                  onPick={setNewMaterial}
                />
              )}
            </div>
            <button
              type="button"
              className={btnOutline}
              disabled={busy || newBazisName.trim() === "" || !newMaterial}
              onClick={() => void addMaterialMapEntry()}
            >
              Добавить соответствие
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <button
          type="button"
          className={btnOutline}
          disabled={busy}
          onClick={() => void resetToDefaults()}
        >
          Вернуть стартовый набор
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || hasDagError}
          title={hasDagError ? "Исправьте зависимости задач в шаблонах" : undefined}
          onClick={() => void save()}
        >
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  )
}
