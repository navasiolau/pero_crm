"use client"

import * as React from "react"
import Link from "next/link"
import type { Role } from "@prisma/client"

import { NavMain } from "@/components/nav-main"
import { Logo } from "@/components/logo"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { navItemsForRole } from "@/lib/nav"

export function AppSidebar({
  roles,
  ...props
}: { roles: Role[] } & React.ComponentProps<typeof Sidebar>) {
  const items = navItemsForRole(roles)
  const { setOpenMobile } = useSidebar()
  const mainItems = items.filter((item) => item.group === "main")
  const manageItems = items.filter((item) => item.group === "manage")

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />} onClick={() => setOpenMobile(false)}>
              <Logo className="size-8" />
              <span className="truncate text-base font-semibold">PERO CRM</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain label="Основное" items={mainItems} />
        <NavMain label="Управление" items={manageItems} />
      </SidebarContent>
    </Sidebar>
  )
}
