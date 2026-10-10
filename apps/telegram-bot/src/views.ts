export const WAREHOUSE_ROLES=["ADMIN","DIRECTOR","MANAGER","PROCUREMENT"];
import type { ProjectCard, FinanceInfo } from "./crm";

// Подписи и форматирование для сообщений бота. Часть констант повторяет
// src/lib/… CRM — бот изолирован и не импортирует код приложения.

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  DIRECTOR: "Директор",
  MANAGER: "Менеджер",
  ENGINEER: "Инженер",
  WORKER: "Работник",
  MOUNTER: "Монтажник",
  ACCOUNTANT: "Бухгалтер",
  PROCUREMENT: "Снабженец",
  WORK_COORDINATOR: "Ответственный за работы",
};

export const STAGE_LABELS: Record<string, string> = {
  LEAD: "Лид",
  ESTIMATE: "Просчёт",
  CONTRACT: "Договор",
  IN_WORK: "В работе",
  DONE: "Завершён",
  RECLAMATION: "Рекламация",
  PAUSED: "Пауза",
  REFUSED: "Отказ",
};

// Порядок кнопок смены этапа: основные + служебные (§6)
export const STAGE_ORDER = [
  "LEAD",
  "ESTIMATE",
  "CONTRACT",
  "IN_WORK",
  "DONE",
  "RECLAMATION",
  "PAUSED",
  "REFUSED",
];

export const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

export const FINANCE_ROLES = ["ADMIN", "DIRECTOR", "ACCOUNTANT", "PROCUREMENT"];

export function hasAny(roles: string[], needed: string[]): boolean {
  return needed.some((role) => roles.includes(role));
}

export function rolesLabel(roles: string[]): string {
  return roles
    .map((role) => ROLE_LABELS[role] ?? role)
    .join(" · ");
}

export function formatMoney(amount: number | string, currency: string): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${formatted} ${currency}`;
}

export function daysOnStage(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function projectCardText(
  project: ProjectCard,
  finance: FinanceInfo | null,
): string {
  const lines = [
    `📦 П-${project.number} «${project.title}»`,
    `Клиент: ${project.client}${project.clientPhone ? ` · ${project.clientPhone}` : ""}`,
    `Этап: ${STAGE_LABELS[project.stage] ?? project.stage} (${daysOnStage(project.stageChangedAt)} дн.)`,
    `Менеджер: ${project.managerName ?? "—"}`,
    `Валюта: ${project.currency}`,
    `Изделий: ${project.productsCount}`,
    `Сумма по проекту: ${formatMoney(project.totalExpected, project.currency)}`,
  ];
  if (finance) {
    lines.push(
      `Оплачено: ${formatMoney(finance.incomeByn, "BYN")} · Расходы: ${formatMoney(finance.expenseByn, "BYN")} (экв. BYN)`,
    );
  }
  if (project.address) {
    lines.push(`Адрес: ${project.address}`);
  }
  return lines.join("\n");
}

export function parseAmount(text: string): number | null {
  const normalized = text.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value > 0 ? value : null;
}
