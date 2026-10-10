"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { ChevronsUpDownIcon, LoaderCircleIcon, LogOutIcon, SendIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { toast } from "sonner"

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
  const logoutForm = useRef<HTMLFormElement>(null);
  const logoutSubmitting = useRef(false);
  const [logoutError, submitLogout, logoutPending] = useActionState<string | undefined, FormData>(async () => {
    try {
      return await logout();
    } catch (error) {
      unstable_rethrow(error);
      return "Не удалось выйти. Попробуйте ещё раз.";
    }
  }, undefined);

  useEffect(() => {
    if (!logoutPending) {
      logoutSubmitting.current = false;
      if (logoutError) toast.error(logoutError);
    }
  }, [logoutError, logoutPending]);

  return (
    <>
    {/* Форма остаётся смонтированной, когда меню закрывается после выбора. */}
    <form ref={logoutForm} action={submitLogout} hidden onSubmit={(event) => {
      if (logoutSubmitting.current) {
        event.preventDefault();
        return;
      }
      logoutSubmitting.current = true;
    }} />
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={logoutPending}
        render={
          <Button
            variant="ghost"
            className="h-9 min-w-0 shrink gap-2 px-2"
            aria-label="Меню пользователя"
            aria-busy={logoutPending}
          />
        }
      >
        {logoutPending ? (
          <>
            <LoaderCircleIcon className="size-4 animate-spin" />
            <span role="status">Выходим…</span>
          </>
        ) : (
          <>
            <Avatar className="size-7 shrink-0">
              <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 max-w-40 truncate text-sm font-medium lg:inline">
              {user.name}
            </span>
            <ChevronsUpDownIcon className="hidden size-4 shrink-0 text-muted-foreground lg:inline" />
          </>
        )}
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
        <DropdownMenuItem variant="destructive" disabled={logoutPending} onClick={() => {
          if (!logoutSubmitting.current) logoutForm.current?.requestSubmit();
        }}>
          <LogOutIcon />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      <TelegramLinkDialog open={telegramOpen} onOpenChange={setTelegramOpen} />
    </>
  )
}
