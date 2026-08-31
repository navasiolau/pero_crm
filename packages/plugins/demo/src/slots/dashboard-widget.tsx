"use client"

import type { SlotPropsMap } from "@pero/plugin-sdk"

// Виджет демо-плагина на дашборде (слот dashboard.widget).
export default function DashboardWidget({
  settings,
}: SlotPropsMap["dashboard.widget"]) {
  const greeting =
    typeof settings.greeting === "string"
      ? settings.greeting
      : "Привет из демо-плагина!"
  const showEventTip = settings.showEventTip !== false
  const accent = settings.widgetStyle === "accent"

  return (
    <div
      className={
        accent
          ? "rounded-xl border border-primary/40 bg-primary/5 p-4"
          : "rounded-xl border bg-card p-4 text-card-foreground"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Демо-плагин</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          плагин
        </span>
      </div>
      <p className="mt-2 text-sm">{greeting}</p>
      {showEventTip ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Слот, настройки и события работают через ядро — отключите модуль в
          «Настройки → Модули», и этот виджет исчезнет.
        </p>
      ) : null}
    </div>
  )
}
