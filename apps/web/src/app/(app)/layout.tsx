import { redirect } from "next/navigation";

import {prisma} from "@/lib/prisma";
import {isCalendarEnabled} from "@/lib/calendar-access";
import {canUseKpEditor} from "@/lib/kp-editor-access";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { NotificationsBell } from "@/components/notifications-bell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const actor = await prisma.user.findUnique({where:{id:session.user.id},select:{active:true,roles:true,calendarEnabled:true}});
  const calendarEnabled = !!actor?.active && isCalendarEnabled(actor);
  const kpEnabled = canUseKpEditor(actor, process.env.PERO_KP_ENABLED === '1');
  return (
    <AppShell calendarEnabled={calendarEnabled} kpEnabled={kpEnabled}
      user={{
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        roles: session.user.roles,
      }}
      headerExtras={<NotificationsBell />}
    >
      {children}
    </AppShell>
  );
}
