import { definePlugin } from "@pero/plugin-sdk"

// Демо-плагин: задействует все точки расширения ядра (§14).
export const demoPlugin = definePlugin({
  id: "demo",
  name: "Демо-плагин",
  version: "0.1.0",
  apiVersion: 1,
  description:
    "Проверка плагинного ядра: виджет на дашборде, вкладка в проекте, команда «Пинг», подписка на события.",
  permissions: ["projects:read"],
  settingsSchema: [
    {
      key: "greeting",
      label: "Приветствие",
      type: "string",
      description: "Текст, который виджет показывает на дашборде",
      default: "Привет из демо-плагина!",
    },
    {
      key: "showEventTip",
      label: "Подсказка про события",
      type: "boolean",
      description: "Показывать в виджете строку про шину событий",
      default: true,
    },
    {
      key: "widgetStyle",
      label: "Стиль виджета",
      type: "select",
      default: "default",
      options: [
        { value: "default", label: "Обычный" },
        { value: "accent", label: "Акцентный" },
      ],
    },
  ],
  slots: {
    "dashboard.widget": () => import("./slots/dashboard-widget"),
    "project.tab": () => import("./slots/project-tab"),
    "settings.page": () => import("./slots/settings-note"),
  },
  hooks: {
    onDomainEvent: async (event, ctx) => {
      await ctx.logger.info(`Получено событие ${event.type}`)
    },
    onEnable: async (ctx) => {
      await ctx.audit({
        entity: "plugin",
        entityId: ctx.pluginId,
        action: "enable",
      })
    },
    onDisable: async (ctx) => {
      await ctx.audit({
        entity: "plugin",
        entityId: ctx.pluginId,
        action: "disable",
      })
    },
  },
  commands: [
    {
      id: "ping",
      name: "Пинг",
      description: "Проверочная команда — пишет отметку в журнал изменений",
      run: async (ctx) => {
        await ctx.audit({
          entity: "plugin",
          entityId: ctx.pluginId,
          action: "command.ping",
          newValue: { at: new Date().toISOString() },
        })
        await ctx.emit("demo.ping", { at: new Date().toISOString() })
        return "Понг! Отметка записана в журнал изменений."
      },
    },
  ],
})
