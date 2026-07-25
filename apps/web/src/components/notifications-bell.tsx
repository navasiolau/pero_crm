"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getBellData,
  markAllRead,
  markRead,
} from "@/server/notifications/actions";

type BellItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const POLL_INTERVAL_MS = 30_000;

// Колокольчик уведомлений в шапке (§6.1): сам опрашивает сервер
// (при монтировании, при открытии и раз в 30 сек) — данные всегда свежие,
// layout их не передаёт.
export function NotificationsBell() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<BellItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await getBellData();
      setUnread(data.unread);
      setItems(data.items);
    } catch {
      // Сессия истекла или сеть отвалилась — повторим по таймеру
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refresh();
      }}
    >
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
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Уведомления</span>
            {unread > 0 ? (
              <button
                className="text-xs font-normal text-muted-foreground hover:text-foreground"
                onClick={() =>
                  startTransition(async () => {
                    await markAllRead();
                    await refresh();
                  })
                }
              >
                Прочитать все
              </button>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
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
              onClick={() => {
                setOpen(false);
                startTransition(async () => {
                  if (!item.read) await markRead(item.id);
                  if (item.link) router.push(item.link);
                  refresh();
                });
              }}
            >
              <span className={`text-sm ${item.read ? "text-muted-foreground" : "font-medium"}`}>
                {item.title}
              </span>
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
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
        >
          <span className="w-full text-center text-sm text-muted-foreground">
            Все уведомления
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
