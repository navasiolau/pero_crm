import type { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// Типы уведомлений (§6.1). Org — получают админ/директор/менеджер (по настройке),
// personal — адресные (работник/монтажник/инженер всегда, без настройки).
export const NOTIFICATION_TYPES = [
  { id: "project.created", label: "Новый проект", kind: "org" },
  { id: "project.stageChanged", label: "Смена этапа проекта", kind: "org" },
  { id: "communication.added", label: "Новая коммуникация", kind: "org" },
  { id: "file.added", label: "Новый файл", kind: "org" },
  { id: "payment.added", label: "Новый приход по проекту", kind: "org" },
  { id: "expense.added", label: "Новый расход по проекту", kind: "org" },
  { id: "stock.expense", label: "Списание материала на проект", kind: "org" },
  { id: "task.assigned", label: "Вам назначена задача", kind: "personal" },
  { id: "task.statusChanged", label: "Изменение по вашей задаче", kind: "personal" },
  { id: "payroll.accrued", label: "Начисление зарплаты", kind: "personal" },
  { id: "payroll.payout", label: "Выплата зарплаты", kind: "personal" },
] as const;

export type NotificationKind = "org" | "personal";

const CONFIGURABLE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ACCOUNTANT"];
const ORG_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ACCOUNTANT"];

function typeKind(type: string): NotificationKind {
  return (
    (NOTIFICATION_TYPES.find((t) => t.id === type)?.kind as
      | NotificationKind
      | undefined) ?? "org"
  );
}

async function isEnabledFor(userId: string, role: Role, type: string) {
  // Работник/монтажник/инженер настраивать уведомления не могут — всегда вкл (§6.1)
  if (!CONFIGURABLE_ROLES.includes(role)) return true;
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  return pref?.enabled ?? true;
}

// Отправка уведомления пользователю с учётом роли и настроек.
export async function notifyUser(input: {
  userId: string;
  role: Role;
  type: string;
  title: string;
  body?: string;
  link?: string;
}) {
  if (!(await isEnabledFor(input.userId, input.role, input.type))) return;
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

// Орг-wide уведомление (§6.1): админ/директор/менеджер, кроме автора действия.
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
      role: { in: ORG_ROLES },
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
