import type { SlotPropsMap } from "@pero/plugin-sdk"

// Страница настроек демо-плагина (слот settings.page).
export default function SettingsNote(_props: SlotPropsMap["settings.page"]) {
  return (
    <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      Этот блок отрисован самим демо-плагином (слот{" "}
      <code>settings.page</code>). Форма выше собрана ядром автоматически по
      манифесту <code>settingsSchema</code>.
    </div>
  )
}
