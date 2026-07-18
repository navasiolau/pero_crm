"use client"

import { usePathname } from "next/navigation"

import { NavUser, type ShellUser } from "@/components/nav-user"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { sectionTitle } from "@/lib/nav"

export function SiteHeader({ user }: { user: ShellUser }) {
  const pathname = usePathname()

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="truncate text-base font-medium">
          {sectionTitle(pathname)}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <NavUser user={user} />
        </div>
      </div>
    </header>
  )
}
