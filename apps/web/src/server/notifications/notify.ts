import type { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// Типы уведомлений (§6.1). Org — ролевые рассылки (кому — см. ORG_TYPE_ROLES),
// personal — адресные конкретному человеку. Настраивать типы могут все роли,
// по умолчанию всё включено.
export const NOTIFICATION_TYPES = [
  { id: "project.created", label: "Новый проект", kind: "org" },
  { id: "project.stageChanged", label: "Смена этапа проекта", kind: "org" },
  { id: "communication.added", label: "Новая коммуникация", kind: "org" },
  { id: "file.added", label: "Новый файл", kind: "org" },
  { id: "payment.added", label: "Новый приход по проекту", kind: "org" },
  { id: "expense.added", label: "Новый расход по проекту", kind: "org" },
  { id: "stock.expense", label: "Списание материала на проект", kind: "org" },
  { id: "payroll.orgPayout", label: "Выплаты и авансы сотрудникам", kind: "org" },
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
const OFFICE_ORG: Role[] = ["ADMIN", "DIRECTOR", "MANAGER"];
const FINANCE_ORG: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ACCOUNTANT"];
const PAYROLL_ORG: Role[] = ["ADMIN", "DIRECTOR", "ACCOUNTANT"];

const ORG_TYPE_ROLES: Record<string, Role[]> = {
  "payment.added": FINANCE_ORG,
  "expense.added": FINANCE_ORG,
  "payroll.orgPayout": PAYROLL_ORG,
  "payroll.orgAccrued": PAYROLL_ORG,
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

// Типы, которые роль реально может получать (для страницы настройки):
// personal — все, org — по ролевой карте.
export function receivableTypesFor(role: Role) {
  return NOTIFICATION_TYPES.filter(
    (t) => t.kind === "personal" || orgRolesFor(t.id).includes(role),
  );
}

async function isEnabledFor(userId: string, type: string) {
  // По умолчанию всё включено (§6.1); отключить можно в /notifications
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  return pref?.enabled ?? true;
}

// Отправка уведомления пользователю с учётом его настроек типов.
export async function notifyUser(input: {
  userId: string;
  role: Role;
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

// Орг-уведомление: получатели — роли из карты для данного типа,
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
      role: { in: orgRolesFor(input.type) },
      id: input.exceptUserId ? { not: input.exceptUserId } : undefined,
    },
    select: { id: true, role: true },
  });
  for (const user of users) {
    await notifyUser({ ...input, userId: user.id, role: user.role });
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
    select: { id: true, role: true, active: true },
  });
  if (!user?.active) return;
  await notifyUser({ ...input, userId: user.id, role: user.role });
}

export function isOrgType(type: string) {
  return typeKind(type) === "org";
}
