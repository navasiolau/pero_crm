import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { NotificationsBell } from "@/components/notifications-bell";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

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

  return (
    <AppShell
      user={{
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        role: session.user.role,
      }}
      headerExtras={
        <NotificationsBell
          unread={unread}
          items={items.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            link: item.link,
            createdAt: item.createdAt.toISOString(),
          }))}
        />
      }
    >
      {children}
    </AppShell>
  );
}
