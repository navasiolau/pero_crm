"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markAllRead } from "@/server/notifications/actions";

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
}

// Колокольчик уведомлений в шапке (§6.1): непрочитанные + переход на страницу.
export function NotificationsBell({
  items,
  unread,
}: {
  items: NotificationItem[];
  unread: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Уведомления" />
        }
      >
        <span className="relative">
          <Bell className="size-5" />
          {unread > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Уведомления</span>
          {unread > 0 ? (
            <button
              className="text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={() =>
                startTransition(async () => {
                  await markAllRead();
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Прочитать все
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Уведомлений нет
          </div>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="flex flex-col items-start gap-0.5 px-3 py-2"
              onSelect={() => {
                setOpen(false);
                if (item.link) router.push(item.link);
              }}
            >
              <span className="text-sm">{item.title}</span>
              {item.body ? (
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {item.body}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleString("ru-RU")}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/notifications")}>
          <span className="w-full text-center text-sm text-muted-foreground">
            Все уведомления и настройка
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
