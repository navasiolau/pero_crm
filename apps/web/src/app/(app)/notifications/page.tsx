import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  getMyPreferences,
  listMyNotifications,
} from "@/server/notifications/actions";

import { NotificationsView } from "./notifications-view";

export const dynamic = "force-dynamic";

// Уведомления: лента с пагинацией (новые сверху) + настройка типов (все роли, §6.1).
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { page: param } = await searchParams;
  const page = Math.max(1, Number(param) || 1);

  const [data, prefs] = await Promise.all([
    listMyNotifications(page),
    getMyPreferences(),
  ]);

  return (
    <NotificationsView
      items={data.items}
      page={data.page}
      pageSize={data.pageSize}
      total={data.total}
      prefs={prefs.prefs}
    />
  );
}
