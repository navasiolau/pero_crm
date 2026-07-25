"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { markAllRead, markRead, setPreference } from "@/server/notifications/actions";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface Pref {
  id: string;
  label: string;
  enabled: boolean;
}

export function NotificationsView({
  items,
  page,
  pageSize,
  total,
  prefs,
}: {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
  prefs: Pref[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = items.filter((item) => !item.read).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const goToPage = (next: number) => {
    router.push(`/notifications?page=${next}`);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Уведомления</h1>
          {unread > 0 ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markAllRead();
                })
              }
            >
              Прочитать все ({unread})
            </Button>
          ) : null}
        </div>

        {items.map((item) => (
          <Card key={item.id} className={item.read ? "opacity-60" : ""}>
            <CardContent className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{item.title}</div>
                {item.body ? (
                  <div className="text-sm text-muted-foreground">{item.body}</div>
                ) : null}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{new Date(item.createdAt).toLocaleString("ru-RU")}</span>
                  {item.link ? (
                    <Link href={item.link} className="underline underline-offset-2">
                      Открыть
                    </Link>
                  ) : null}
                </div>
              </div>
              {!item.read ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await markRead(item.id);
                    })
                  }
                >
                  Прочитано
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            Уведомлений пока нет
          </div>
        ) : null}

        {pageCount > 1 ? (
          <div className="flex items-center justify-center gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="size-4" />
              Назад
            </Button>
            <span className="text-sm text-muted-foreground">
              Стр. {page} из {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => goToPage(page + 1)}
            >
              Вперёд
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Настройка уведомлений</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {prefs.map((pref) => (
              <div key={pref.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{pref.label}</span>
                <Switch
                  checked={pref.enabled}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    startTransition(async () => {
                      const result = await setPreference(pref.id, checked);
                      if (!result.ok) toast.error(result.error ?? "Ошибка");
                    })
                  }
                />
              </div>
            ))}
            <Badge variant="outline" className="w-fit">
              по умолчанию всё включено
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
