"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { MATERIAL_UNITS } from "../materials"
import { createMaterial, fetchMaterials, type MaterialOption } from "./api"
import { btnGhostSm, btnOutline, btnPrimary, inputCls } from "./styles"

// Комбобокс номенклатуры склада (этап C): поиск по подстроке через
// GET /api/bazis-import/materials?q= и создание новой позиции инлайн
// (POST /materials, цена 0 — правит склад). UX повторяет SearchableSelect
// ядра: поле с фильтром, список под ним. Своя разметка — shadcn пакету
// недоступен. Компонент только ВЫБИРАЕТ материал; запись в маппинг —
// дело родителя (onPick).
export function MaterialSelect({
  onPick,
  createDefaults,
  placeholder = "— выберите материал склада —",
  disabled,
}: {
  onPick: (material: MaterialOption) => void
  /** Подстановка в форму создания (имя позиции Базиса, переведённая единица). */
  createDefaults?: { name?: string; unit?: string }
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<MaterialOption[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createUnit, setCreateUnit] = useState("шт")
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Закрытие по клику вне компонента.
  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Поиск с дебаунсом: пока список открыт, следим за фильтром.
  useEffect(() => {
    if (!open) return
    setLoading(true)
    const timer = setTimeout(() => {
      void fetchMaterials({ q: query }).then((result) => {
        setItems(result.ok ? result.items : [])
        setLoading(false)
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [query, open])

  function openList() {
    if (disabled || busy) return
    setOpen(true)
  }

  function pick(material: MaterialOption) {
    setOpen(false)
    setCreating(false)
    setQuery("")
    onPick(material)
  }

  function startCreate() {
    setCreateName(query.trim() || createDefaults?.name || "")
    const defaultUnit = createDefaults?.unit ?? "шт"
    setCreateUnit(
      (MATERIAL_UNITS as readonly string[]).includes(defaultUnit) ? defaultUnit : "шт",
    )
    setCreating(true)
  }

  async function submitCreate() {
    const name = createName.trim()
    if (name === "") return
    setBusy(true)
    try {
      const result = await createMaterial({ name, unit: createUnit })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Материал «${result.item.name}» создан (цену задаст склад)`)
      pick(result.item)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-56">
      <input
        className={inputCls}
        placeholder={placeholder}
        value={query}
        disabled={disabled || busy}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          setQuery(event.target.value)
          setCreating(false)
          openList()
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false)
            setCreating(false)
          }
        }}
      />
      {open ? (
        <div className="absolute z-20 mt-1 flex max-h-72 w-full min-w-72 flex-col overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {creating ? (
            <div className="flex flex-col gap-2 p-2">
              <div className="text-xs font-medium text-muted-foreground">
                Новый материал склада
              </div>
              <input
                className={inputCls}
                value={createName}
                autoFocus
                placeholder="Название"
                onChange={(event) => setCreateName(event.target.value)}
              />
              <select
                className={inputCls}
                value={createUnit}
                onChange={(event) => setCreateUnit(event.target.value)}
              >
                {MATERIAL_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => setCreating(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy || createName.trim() === ""}
                  onClick={() => void submitCreate()}
                >
                  {busy ? "Создаём…" : "Создать"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">Поиск…</div>
              ) : items.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  Ничего не найдено
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => pick(item)}
                  >
                    <span className="truncate">
                      {item.name}
                      {item.active ? "" : " (неактивен)"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.unit}
                      {item.sku ? ` · ${item.sku}` : ""}
                    </span>
                  </button>
                ))
              )}
              <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  className={`${btnOutline} w-full`}
                  onClick={startCreate}
                >
                  Создать новую{query.trim() !== "" ? ` «${query.trim()}»` : ""}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
