import type { SlotPropsMap } from "@pero/plugin-sdk"

// Нативная вкладка демо-плагина в карточке проекта (слот project.tab).
export default function ProjectTab({
  projectId,
  settings,
}: SlotPropsMap["project.tab"]) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground">
      <h3 className="text-sm font-medium">Демо-плагин</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Эта вкладка отрисована пакетом <code>packages/plugins/demo</code> внутри
        карточки проекта <code>{projectId}</code> — без iframe, на общих
        токенах темы.
      </p>
      <p className="mt-2 text-sm">
        Настройка «Приветствие»:{" "}
        <span className="text-muted-foreground">
          {typeof settings.greeting === "string"
            ? settings.greeting
            : "не задана"}
        </span>
      </p>
    </div>
  )
}
