// SDK плагинов PERO CRM (§14 плана).
// Плагин = нативный пакет в монорепозитории (packages/plugins/<id>),
// экспортирующий манифест через definePlugin(). Хост импортирует манифест
// только на сервере; UI-слоты грузятся через next/dynamic.

import type { ComponentType } from "react"

/** Версия Plugin API ядра. Совместимость: N и N-1. */
export const CURRENT_API_VERSION = 1 as const

export const SLOT_IDS = [
  "dashboard.widget",
  "project.tab",
  "project.action",
  "task.action",
  "settings.page",
] as const

export type SlotId = (typeof SLOT_IDS)[number]

/** Поле автоформы настроек (Настройки → Модули). */
export interface SettingField {
  key: string
  label: string
  type: "string" | "number" | "boolean" | "select"
  description?: string
  default?: string | number | boolean
  options?: { value: string; label: string }[] // для select
  required?: boolean
}

/** Пропсы, которые ядро передаёт компонентам слотов. */
export interface SlotPropsMap {
  "dashboard.widget": { role: string; settings: Record<string, unknown> }
  "project.tab": { projectId: string; settings: Record<string, unknown> }
  "project.action": { projectId: string; settings: Record<string, unknown> }
  "task.action": { taskId: string; settings: Record<string, unknown> }
  "settings.page": { settings: Record<string, unknown> }
}

/** Ленивая загрузка компонента слота (для next/dynamic в ядре). */
export type SlotLoader<S extends SlotId> = () => Promise<{
  default: ComponentType<SlotPropsMap[S]>
}>

export interface DomainEventPayload {
  id: string
  type: string
  payload: unknown
  actor: string
  createdAt: Date
}

export interface PluginLogger {
  info(message: string): Promise<void>
  error(message: string): Promise<void>
}

/** Запись в журнал изменений (§5) — actor подставляется как plugin:<id>. */
export interface AuditEntry {
  entity: string
  entityId: string
  action: string
  field?: string
  oldValue?: unknown
  newValue?: unknown
}

/**
 * Контекст, который ядро даёт хукам и командам плагина.
 * `db` типизирован как unknown — пакет не зависит от @prisma/client хоста;
 * внутри доверенного плагина допустимо приведение к PrismaClient.
 */
export interface PluginContext {
  pluginId: string
  actor: string // "plugin:<id>"
  settings: Record<string, unknown>
  db: unknown
  logger: PluginLogger
  audit: (entry: AuditEntry) => Promise<void>
  emit: (type: string, payload: unknown) => Promise<void>
  requirePermission: (permission: string) => void
}

export interface PluginCommand {
  id: string
  name: string
  description?: string
  /** Возвращаемая строка показывается пользователю как результат. */
  run: (ctx: PluginContext) => Promise<string | void>
}

export interface PluginHooks {
  onDomainEvent?: (
    event: DomainEventPayload,
    ctx: PluginContext,
  ) => Promise<void>
  onEnable?: (ctx: PluginContext) => Promise<void>
  onDisable?: (ctx: PluginContext) => Promise<void>
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  description?: string
  /** Запрошенные права: "projects:read", "tasks:write", "files:read", ... */
  permissions: string[]
  slots?: Partial<{ [S in SlotId]: SlotLoader<S> }>
  hooks?: PluginHooks
  commands?: PluginCommand[]
  settingsSchema?: SettingField[]
}

export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest
}
