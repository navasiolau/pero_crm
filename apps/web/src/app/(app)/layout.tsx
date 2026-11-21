import Link from "next/link";
import { headers } from "next/headers";
import { TelegramFileViewerScope } from "@/components/file-viewer";
import { TelegramFinanceLinkSettings } from "@/components/telegram-finance-link-settings";
import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import { TELEGRAM_FINANCE_LAYOUT_HEADER } from "@/server/telegram/finance-security";
import { redirect } from "next/navigation";

import {prisma} from "@/lib/prisma";
import {isCalendarEnabled} from "@/lib/calendar-access";
import {canUseKpEditor} from "@/lib/kp-editor-access";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { PageNavigationProvider } from "@/components/page-navigation-provider";
import { homePathForRoles } from "@/lib/home-route";
import { NotificationsBell } from "@/components/notifications-bell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const scoped = (await headers()).get(TELEGRAM_FINANCE_LAYOUT_HEADER) === "active";
  const session = scoped ? await scopedFinanceAuth() : await auth();
  const telegram = !!session && "telegramFinance" in session;
  if (!session?.user) {
    redirect(scoped ? "/telegram/finance" : "/login");
  }
  const scope = JSON.stringify([session.user.id, [...session.user.roles].sort(), telegram]);
  const content = (
    <PageNavigationProvider key={scope} scope={scope} home={telegram ? "/finance" : homePathForRoles(session.user.roles)}>
      {children}
    </PageNavigationProvider>
  );

  if (telegram) {
    return (
      <div className="min-h-dvh">
        <header className="border-b">
          <nav aria-label="Финансовое пространство" className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <Link href="/finance" className="font-semibold">Финансы</Link>
            <Link href="/logistics">ТТН</Link>
            <Link href="/notifications">Уведомления</Link>
            <TelegramFinanceLinkSettings />
          </nav>
        </header>
        <main className="mx-auto min-w-0 max-w-7xl px-4 py-5"><TelegramFileViewerScope>{content}</TelegramFileViewerScope></main>
      </div>
    );
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
      {content}
    </AppShell>
  );
}
