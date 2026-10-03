"use client"

import { usePathname } from "next/navigation"

import { NavUser, type ShellUser } from "@/components/nav-user"
import { Omnisearch } from "@/components/omnisearch"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {canAccessOperationalPath} from "@/lib/operational-access"
import { sectionTitle } from "@/lib/nav"

export function SiteHeader({
  user,
  extras,
}: {
  user: ShellUser
  extras?: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <header className="flex min-w-0 h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear md:h-(--header-height)">
      <div className="flex w-full min-w-0 items-center gap-1 px-2 md:px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" aria-label="Открыть меню" />
        <Separator
          orientation="vertical"
          className="mx-2 hidden h-4 data-vertical:self-auto md:block"
        />
        <h1 className="min-w-0 truncate text-sm font-medium md:text-base">
          {sectionTitle(pathname)}
        </h1>
        <div className="ml-auto flex min-w-0 items-center gap-0 md:gap-1">
          {canAccessOperationalPath(user.roles,"/api/search")?<Omnisearch />:null}
          {extras}
          <ThemeToggle />
          <NavUser user={user} />
        </div>
      </div>
    </header>
  )
}
