import type { ProductStatus, Role } from "@prisma/client";
import { canViewProductDrafts } from "./product-drafts";
import { fieldProductStatuses } from "./field-product-visibility";
import { MANAGER_ROLES } from "./roles";
import { ENGINEER_PRODUCT_STATUSES } from "./engineering-read-access";

export const ACTIVE_PRODUCT_STATUS_IDS = ["DRAFT", "PREPARATION", "DESIGN", "PRODUCTION", "STORAGE", "INSTALLATION", "DONE"] as const satisfies readonly ProductStatus[];
export function isActiveProductStatus(value: unknown): value is (typeof ACTIVE_PRODUCT_STATUS_IDS)[number] {
  return ACTIVE_PRODUCT_STATUS_IDS.some(status => status === value);
}

// Статусы изделия (§6): производственная цепочка от подготовки
// до готовности. Старые подписи сохраняются только для истории.
export const PRODUCT_STATUSES: {
  id: ProductStatus;
  label: string;
  columnLabel?: string;
  service?: boolean;
}[] = [
  { id: "DRAFT", label: "Черновик", columnLabel: "Черновики" },
  { id: "PREPARATION", label: "Подготовка" },
  { id: "DESIGN", label: "Проектирование" },
  { id: "PRODUCTION", label: "В производстве" },
  { id: "STORAGE", label: "На складе ГП" },
  { id: "INSTALLATION", label: "Установка" },
  { id: "DONE", label: "Готово" },
];

/** Один порядок колонок, фильтров и селектов с учётом приватности черновиков. */
export function visibleProductStatuses(roles: readonly Role[], canAccessDraft = false) {
  const full = MANAGER_ROLES.some(role => roles.includes(role)) || roles.includes("PROCUREMENT");
  const statuses = new Set(fieldProductStatuses(roles));
  if (roles.includes("ENGINEER")) {
    for (const status of ENGINEER_PRODUCT_STATUSES) statuses.add(status);
  }
  return PRODUCT_STATUSES.filter(status =>
    (full || statuses.has(status.id)) && (status.id !== "DRAFT" || canViewProductDrafts(roles) || (roles.includes("MANAGER") && canAccessDraft)),
  );
}

export const productStatusLabels = Object.fromEntries(
  [...PRODUCT_STATUSES.map((status) => [status.id, status.label]), ["RECLAMATION", "Рекламация"]],
) as Record<ProductStatus, string>;

// Визуальная дифференциация — по образцу stageStyles: заголовки колонок
// мини-канбана и «таблетки» статусов. Колонки тонированы в цвет статуса;
// «Рекламация» — служебное состояние вне нормального воркфлоу, выделяется
// всегда (плюс border-2 на колонке).
export const productStatusStyles: Record<
  ProductStatus,
  { column: string; header: string; badge: string }
> = {
  DRAFT: {
    column: "border-zinc-500/25 bg-zinc-500/5",
    header: "text-zinc-700 dark:text-zinc-400",
    badge: "bg-muted text-muted-foreground",
  },
  PREPARATION: {
    column: "border-slate-500/25 bg-slate-500/5",
    header: "text-slate-700 dark:text-slate-400",
    badge: "bg-muted text-muted-foreground",
  },
  DESIGN: {
    column: "border-violet-500/50 bg-violet-500/10",
    header: "text-violet-700 dark:text-violet-400",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  PRODUCTION: {
    column: "border-blue-500/50 bg-blue-500/10",
    header: "text-blue-700 dark:text-blue-400",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  STORAGE: {
    column: "border-cyan-500/50 bg-cyan-500/10",
    header: "text-cyan-700 dark:text-cyan-400",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  },
  INSTALLATION: {
    column: "border-emerald-500/50 bg-emerald-500/10",
    header: "text-emerald-700 dark:text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  DONE: {
    // Спокойное завершение — едва заметный тинт без активной рамки.
    column: "border-emerald-500/25 bg-emerald-500/5",
    header: "text-emerald-800/70 dark:text-emerald-300/70",
    badge: "bg-muted text-muted-foreground",
  },
  RECLAMATION: {
    column: "border-amber-500/60 bg-amber-500/10",
    header: "text-amber-700 dark:text-amber-400",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
};

// Дней в статусе → подсветка «зависших» карточек (как daysOnStage)
export function daysOnStatus(statusChangedAt: string | Date): number {
  const ms = Date.now() - new Date(statusChangedAt).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
