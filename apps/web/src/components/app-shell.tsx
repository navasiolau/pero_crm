"use client"

import { AppSidebar } from "@/components/app-sidebar"
import type { ShellUser } from "@/components/nav-user"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export function AppShell({
  user,
  headerExtras,
  children,
}: {
  user: ShellUser
  headerExtras?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar roles={user.roles} variant="inset" />
      <SidebarInset>
        <SiteHeader user={user} extras={headerExtras} />
        <main className="@container/main flex min-w-0 flex-1 flex-col px-4 py-4 md:py-6 lg:px-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
