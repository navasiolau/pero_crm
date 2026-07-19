"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { NOTIFICATION_TYPES } from "./notify";

const CONFIGURABLE = ["ADMIN", "DIRECTOR", "MANAGER"];

export async function listMyNotifications(take = 30) {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.notification.count({
      where: { userId: session.user.id, readAt: null },
    }),
  ]);
  return { items, unread };
}

export async function markAllRead(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markRead(id: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  await prisma.notification.updateMany({
    where: { id, userId: session.user.id },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return { ok: true };
}

// Настройки типов — только админ/директор/менеджер (§6.1).
export async function getMyPreferences() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const configurable = CONFIGURABLE.includes(session.user.role);
  if (!configurable) return { configurable: false as const, prefs: [] };

  const rows = await prisma.notificationPreference.findMany({
    where: { userId: session.user.id },
  });
  const map = new Map(rows.map((r) => [r.type, r.enabled]));
  return {
    configurable: true as const,
    prefs: NOTIFICATION_TYPES.map((t) => ({
      id: t.id,
      label: t.label,
      enabled: map.get(t.id) ?? true,
    })),
  };
}

export async function setPreference(
  type: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!CONFIGURABLE.includes(session.user.role)) {
    return { ok: false, error: "Настройка недоступна для вашей роли" };
  }
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId: session.user.id, type } },
    create: { userId: session.user.id, type, enabled },
    update: { enabled },
  });
  revalidatePath("/notifications");
  return { ok: true };
}
