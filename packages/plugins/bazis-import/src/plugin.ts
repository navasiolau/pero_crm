import { CURRENT_API_VERSION, definePlugin } from "@pero/plugin-sdk"

// Плагин «Импорт из Базис-Мебельщик» (техплан: «PERO CRM v2 — Техплан плагина
// Базис-Мебельщик.md»). Парсер/нормализация — src/parser/, применение и откат —
// src/apply.ts, UI — src/ui/ (слоты ниже). Команды и хуки — следующие этапы.
export const bazisImportPlugin = definePlugin({
  id: "bazis-import",
  name: "Импорт из Базис-Мебельщик",
  version: "1.0.0",
  apiVersion: CURRENT_API_VERSION,
  description:
    "Импорт спецификаций Базис-Мебельщик (XML): изделия с деталировкой, " +
    "материалы на склад, работы и задачи по шаблонам.",
  permissions: [
    "projects:read",
    "projects:write",
    "tasks:create",
    "works:create",
    "prices:read",
    "files:read",
    "warehouse:read",
    "notifications:send",
  ],
  // Этап A3: кнопка в шапке карточки проекта + вкладка «Данные Базиса».
  // Этап B2: редактор настроек (классификатор, шаблоны работ/задач).
  // Этап C: потребность склада из деталировки (маппинг материалов —
  // на экране подтверждения и в настройках).
  slots: {
    "project.action": () => import("./ui/ImportButton"),
    "project.tab": () => import("./ui/ProjectTab"),
    "settings.page": () => import("./ui/SettingsPage"),
  },
})
