"use client"

import { useState } from "react"
import { ChevronsUpDownIcon, LogOutIcon, SendIcon } from "lucide-react"

import { logout } from "@/app/(app)/actions"
import { TelegramLinkDialog } from "@/components/telegram-link-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Role } from "@prisma/client"
import { roleComboLabel } from "@/lib/roles"

export type ShellUser = {
  name: string
  email: string
  roles: Role[]
}

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "П"
  )
}

export function NavUser({ user }: { user: ShellUser }) {
  const [telegramOpen, setTelegramOpen] = useState(false);

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-9 gap-2 px-2"
            aria-label="Меню пользователя"
          />
        }
      >
        <Avatar className="size-7">
          <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 truncate text-sm font-medium md:inline">
          {user.name}
        </span>
        <ChevronsUpDownIcon className="hidden size-4 text-muted-foreground md:inline" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                {user.name}
              </span>
              <span className="text-xs">{user.email}</span>
              <span>
                <Badge variant="secondary">{roleComboLabel(user.roles)}</Badge>
              </span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTelegramOpen(true)}>
          <SendIcon />
          Telegram
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => logout()}>
          <LogOutIcon />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      <TelegramLinkDialog open={telegramOpen} onOpenChange={setTelegramOpen} />
    </>
  )
}
