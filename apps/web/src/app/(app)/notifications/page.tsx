import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getMyPreferences } from "@/server/notifications/actions";

import { NotificationsView } from "./notifications-view";

export const dynamic = "force-dynamic";

// Уведомления: лента + настройка типов (настройка — админ/директор/менеджер, §6.1).
export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [items, prefs] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getMyPreferences(),
  ]);

  return (
    <NotificationsView
      items={items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        link: item.link,
        read: !!item.readAt,
        createdAt: item.createdAt.toISOString(),
      }))}
      prefs={prefs.configurable ? prefs.prefs : null}
    />
  );
}
