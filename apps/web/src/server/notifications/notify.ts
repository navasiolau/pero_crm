import type { Role } from "@prisma/client";

import { canReceiveNotificationContent } from "@/lib/notification-access";
import { prisma } from "@/lib/prisma";
import { ADVANCE_ROLES, PAYROLL_MANAGE_ROLES } from "@/lib/roles";
import { notificationPreferenceEnabled, notificationPreferenceTypes } from "./preferences";

// Типы уведомлений (§6.1). Org — ролевые рассылки (кому — см. ORG_TYPE_ROLES),
// personal — адресные конкретному человеку. Настраивать типы могут все роли,
// по умолчанию всё включено.
export const NOTIFICATION_TYPES = [
  {id:"plan.reminder",label:"Напоминания личного плана",kind:"personal"},
  { id: "project.created", label: "Новый проект", kind: "org" },
  { id: "project.stageChanged", label: "Смена этапа проекта", kind: "org" },
  { id: "product.statusChanged", label: "Смена статуса изделия", kind: "org" },
  { id: "communication.added", label: "Новая коммуникация", kind: "org" },
  { id: "file.added", label: "Новый файл", kind: "org" },
  { id: "payment.added", label: "Новый приход по проекту", kind: "org" },
  { id: "expense.added", label: "Новый расход по проекту", kind: "org" },
  { id: "stock.expense", label: "Списание материала на проект", kind: "org" },
  { id: "payroll.orgPayout", label: "Выплаты зарплаты сотрудникам", kind: "org" },
  { id: "payroll.orgAdvance", label: "Авансы сотрудникам", kind: "org" },
  { id: "payroll.orgAccrued", label: "Начисления зарплаты сотрудникам", kind: "org" },
  { id: "task.assigned", label: "Вам назначена задача", kind: "personal" },
  { id: "task.statusChanged", label: "Изменение по вашей задаче", kind: "personal" },
  { id: "payroll.accrued", label: "Начисление зарплаты", kind: "personal" },
  { id: "payroll.payout", label: "Выплата зарплаты", kind: "personal" },
  { id: "user.accountChanged", label: "Изменения моей учётной записи", kind: "personal" },
] as const;

export type NotificationKind = "org" | "personal";

// Кому рассылаются org-уведомления — по типу (§6.1, уточнение владельца):
// финансовые операции (приходы/расходы) — + бухгалтер; ЗП-события — админ/
// директор/бухгалтер (менеджеру зарплата не рассылается); остальное — A/D/M.
const OFFICE_ORG: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "PROCUREMENT"];
const FINANCE_ORG: Role[] = ["ADMIN", "DIRECTOR", "ACCOUNTANT", "PROCUREMENT"];

const ORG_TYPE_ROLES: Record<string, Role[]> = {
  "payment.added": FINANCE_ORG,
  "expense.added": FINANCE_ORG,
  "payroll.orgPayout": PAYROLL_MANAGE_ROLES,
  "payroll.orgAccrued": PAYROLL_MANAGE_ROLES,
  "payroll.orgAdvance": ADVANCE_ROLES,
};

function typeKind(type: string): NotificationKind {
  return (
    (NOTIFICATION_TYPES.find((t) => t.id === type)?.kind as
      | NotificationKind
      | undefined) ?? "org"
  );
}

// Роли, которым вообще может прийти org-тип (для дефолта и настроек)
export function orgRolesFor(type: string): Role[] {
  return ORG_TYPE_ROLES[type] ?? OFFICE_ORG;
}

// Типы, которые пользователь реально может получать (для страницы настройки):
// personal — все, org — объединение ролевых карт по всем его ролям
// (комбинированные роли, §4).
export function receivableTypesFor(roles: Role[] | Role) {
  const list = Array.isArray(roles) ? roles : [roles];
  return NOTIFICATION_TYPES.filter(
    (t) =>
      (t.kind === "personal" && canReceiveNotificationContent(list, t.id)) ||
      list.some((role) => orgRolesFor(t.id).includes(role)),
  );
}

async function isEnabledFor(userId: string, type: string) {
  // По умолчанию всё включено (§6.1); отключить можно в /notifications
  const preferences = await prisma.notificationPreference.findMany({
    where: { userId, type: { in: notificationPreferenceTypes(type) } },
    select: { type: true, enabled: true },
  });
  return notificationPreferenceEnabled(type, new Map(preferences.map(pref => [pref.type, pref.enabled])));
}

// Отправка уведомления пользователю с учётом его настроек типов.
export async function notifyUser(input: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}) {
  if (!(await isEnabledFor(input.userId, input.type))) return;
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}

// Орг-уведомление: получатели — пользователи, у которых хотя бы одна роль
// входит в карту для данного типа (комбинированные роли, §4),
// кроме автора действия и отключивших тип в настройках.
export async function notifyOrg(input: {
  type: string;
  title: string;
  body?: string;
  link?: string;
  exceptUserId?: string;
}) {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      roles: { hasSome: orgRolesFor(input.type) },
      id: input.exceptUserId ? { not: input.exceptUserId } : undefined,
    },
    select: { id: true },
  });
  for (const user of users) {
    await notifyUser({ ...input, userId: user.id });
  }
}

// Адресное уведомление конкретному пользователю (назначение задачи и т.п.).
export async function notifyPerson(input: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, active: true },
  });
  if (!user?.active) return;
  await notifyUser({ ...input, userId: user.id });
}

export function isOrgType(type: string) {
  return typeKind(type) === "org";
}
