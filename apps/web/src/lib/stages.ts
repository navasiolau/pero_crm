import type { ProjectStage } from "@prisma/client";

// Этапы проекта (§6): 5 основных + служебные состояния.
// Общий модуль для сервера и клиента.
export const STAGES: {
  id: ProjectStage;
  label: string;
  service?: boolean;
}[] = [
  { id: "LEAD", label: "Лид" },
  { id: "ESTIMATE", label: "Просчёт" },
  { id: "CONTRACT", label: "Договор" },
  { id: "IN_WORK", label: "В работе" },
  { id: "DONE", label: "Завершён" },
  { id: "RECLAMATION", label: "Рекламация", service: true },
  { id: "PAUSED", label: "Пауза", service: true },
  { id: "REFUSED", label: "Отказ", service: true },
];

export const stageLabels = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
) as Record<ProjectStage, string>;

// Визуальная дифференциация (§6): у каждого этапа свой цвет — заголовки
// колонок канбана и «таблетки» этапов. Колонки канбана тонированы в цвет
// этапа; служебные состояния (Рекламация, Пауза, Отказ) — вне нормального
// воркфлоу, сигнализируют сильнее (плюс border-2 на колонке).
export const stageStyles: Record<
  ProjectStage,
  { column: string; header: string; badge: string }
> = {
  LEAD: {
    column: "border-blue-500/50 bg-blue-500/10",
    header: "text-blue-700 dark:text-blue-400",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  ESTIMATE: {
    column: "border-violet-500/50 bg-violet-500/10",
    header: "text-violet-700 dark:text-violet-400",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  CONTRACT: {
    column: "border-cyan-500/50 bg-cyan-500/10",
    header: "text-cyan-700 dark:text-cyan-400",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  },
  IN_WORK: {
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
  PAUSED: {
    column: "border-slate-400/60 bg-slate-500/10",
    header: "text-slate-600 dark:text-slate-400",
    badge: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  },
  REFUSED: {
    column: "border-destructive/60 bg-destructive/10",
    header: "text-destructive",
    badge: "bg-destructive/15 text-destructive",
  },
};

// Дней на этапе → подсветка «зависших» карточек (§7)
export function daysOnStage(stageChangedAt: string | Date): number {
  const ms = Date.now() - new Date(stageChangedAt).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
