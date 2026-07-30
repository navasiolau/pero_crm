import type { ProductStatus } from "@prisma/client";

// Статусы изделия (§6): производственная цепочка от проектирования
// до готовности + служебная «Рекламация». Общий модуль для сервера и клиента.
export const PRODUCT_STATUSES: {
  id: ProductStatus;
  label: string;
  service?: boolean;
}[] = [
  { id: "DESIGN", label: "Проектирование" },
  { id: "PRODUCTION", label: "В производстве" },
  { id: "DELIVERY", label: "Доставка" },
  { id: "INSTALLATION", label: "Установка" },
  { id: "DONE", label: "Готово" },
  { id: "RECLAMATION", label: "Рекламация", service: true },
];

export const productStatusLabels = Object.fromEntries(
  PRODUCT_STATUSES.map((status) => [status.id, status.label]),
) as Record<ProductStatus, string>;

// Визуальная дифференциация — по образцу stageStyles: заголовки колонок
// мини-канбана и «таблетки» статусов. «Рекламация» — служебное состояние
// вне нормального воркфлоу, выделяется всегда.
export const productStatusStyles: Record<
  ProductStatus,
  { column: string; header: string; badge: string }
> = {
  DESIGN: {
    column: "bg-muted/40",
    header: "text-violet-700 dark:text-violet-400",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  PRODUCTION: {
    column: "bg-muted/40",
    header: "text-blue-700 dark:text-blue-400",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  DELIVERY: {
    column: "bg-muted/40",
    header: "text-cyan-700 dark:text-cyan-400",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  },
  INSTALLATION: {
    column: "bg-muted/40",
    header: "text-emerald-700 dark:text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  DONE: {
    column: "bg-muted/40",
    header: "text-muted-foreground",
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
