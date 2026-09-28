"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scopeNotificationContent } from "@/server/access/notification-visibility";

import { receivableTypesFor } from "./notify";

const NOTIFICATIONS_PAGE_SIZE = 20;

// Данные колокольчика в шапке: непрочитанные + последние 10.
// Колокольчик опрашивает сам (mount/открытие/интервал) — layout данные
// не передаёт, чтобы они не устаревали при клиентских переходах.
export async function getBellData() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.notification.count({
      where: { userId: session.user.id, readAt: null },
    }),
  ]);
  const visibleItems = await scopeNotificationContent(session.user, items, prisma);
  return {
    unread,
    items: visibleItems.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      link: item.link,
      read: !!item.readAt,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

// Лента «Все уведомления»: серверная пагинация, новые сверху.
export async function listMyNotifications(page: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATIONS_PAGE_SIZE,
      skip: (safePage - 1) * NOTIFICATIONS_PAGE_SIZE,
    }),
    prisma.notification.count({ where: { userId: session.user.id } }),
  ]);
  const visibleItems = await scopeNotificationContent(session.user, items, prisma);
  return {
    total,
    page: safePage,
    pageSize: NOTIFICATIONS_PAGE_SIZE,
    items: visibleItems.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      link: item.link,
      read: !!item.readAt,
      createdAt: item.createdAt.toISOString(),
    })),
  };
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

// Настройка типов — для всех ролей (§6.1): каждый видит только те типы,
// которые его роль реально может получать; по умолчанию всё включено.
export async function getMyPreferences() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");

  const rows = await prisma.notificationPreference.findMany({
    where: { userId: session.user.id },
  });
  const map = new Map(rows.map((r) => [r.type, r.enabled]));
  return {
    prefs: receivableTypesFor(session.user.roles).map((t) => ({
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
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId: session.user.id, type } },
    create: { userId: session.user.id, type, enabled },
    update: { enabled },
  });
  revalidatePath("/notifications");
  return { ok: true };
}
