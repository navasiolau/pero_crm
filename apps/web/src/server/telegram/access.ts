import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES, MANAGER_ROLES, WAREHOUSE_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

export const TELEGRAM_SECTION_DENIED = "Вам не доступен этот раздел, если это ошибка - обратитесь к Администратору";

export async function findActiveTelegramLink(where: { chatId: string } | { userId: string }) {
  const link = await prisma.telegramLink.findUnique({
    where,
    select: {
      id: true, chatId: true, linkedAt: true, revokedAt: true, generation: true,
      user: { select: { id: true, name: true, email: true, roles: true, active: true, sessionVersion: true, updatedAt: true } },
    },
  });
  if (!link?.chatId || !link.linkedAt || link.revokedAt || !link.user.active) return null;
  return { ...link, chatId: link.chatId, linkedAt: link.linkedAt };
}

export function telegramBindingVersion(id: string, generation: number, sessionVersion: number) {
  return `${id}:${generation}:${sessionVersion}`;
}

export function telegramBotUser({ id, name, roles }: Pick<User, "id" | "name" | "roles">) {
  const access = {
    projects: hasAnyRole(roles, MANAGER_ROLES),
    finance: hasAnyRole(roles, FINANCE_ROLES),
    warehouse: hasAnyRole(roles, WAREHOUSE_MANAGE_ROLES),
    deniedMessage: TELEGRAM_SECTION_DENIED,
  };
  return { id, name, roles, botAllowed: access.projects || access.finance || access.warehouse, access };
}
