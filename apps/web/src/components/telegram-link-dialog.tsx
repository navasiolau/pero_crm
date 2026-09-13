"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getTelegramLinkStatus,
  requestTelegramLink,
  unlinkTelegram,
} from "@/server/telegram/actions";

type Status = Awaited<ReturnType<typeof getTelegramLinkStatus>>;

// Диалог «Telegram» в меню пользователя: привязка аккаунта по одноразовому
// коду (ссылка t.me/<bot>?start=<код>) и отвязка. Привязка доступна любой
// роли; сам бот — только менеджерам/админам/директору (решение владельца).
export function TelegramLinkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<{ url: string; code: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setLink(null);
      return;
    }
    setStatus(null);
    getTelegramLinkStatus().then(setStatus).catch(() => setStatus(null));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Telegram</DialogTitle>
          <DialogDescription>
            Привязка аккаунта к боту CRM. Бот доступен менеджерам, администраторам
            и директору.
          </DialogDescription>
        </DialogHeader>

        {!status ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : !status.deployed ? (
          <p className="text-sm text-muted-foreground">
            Бот не подключён. Администратор разворачивает сервис telegram-bot —
            после запуска эта кнопка даст ссылку для привязки.
          </p>
        ) : status.linked ? (
          <div className="text-sm">
            Аккаунт привязан:{" "}
            <span className="font-medium">
              {status.username ? `@${status.username}` : "без username"}
            </span>
          </div>
        ) : link ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>Нажмите кнопку и отправьте боту команду запуска (код уже в ссылке):</p>
            <a href={link.url} target="_blank" rel="noreferrer" className="w-fit">
              <Button variant="outline">Открыть бота в Telegram</Button>
            </a>
            <p className="text-muted-foreground">
              Или вручную: откройте бота и отправьте{" "}
              <span className="font-mono">/start {link.code}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Код действует 15 минут.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Аккаунт не привязан. Получите одноразовую ссылку и отправьте боту
            <span className="font-mono"> /start</span>.
          </p>
        )}

        <DialogFooter>
          {status?.linked ? (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await unlinkTelegram();
                  setStatus((prev) => (prev ? { ...prev, linked: false, username: null } : prev));
                  toast.success("Telegram отвязан");
                })
              }
            >
              {pending ? "Отвязка…" : "Отвязать"}
            </Button>
          ) : status?.deployed && !link ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await requestTelegramLink();
                  if (result.ok && result.url && result.code) {
                    setLink({ url: result.url, code: result.code });
                  } else {
                    toast.error(result.error ?? "Не удалось получить ссылку");
                  }
                })
              }
            >
              {pending ? "…" : "Получить ссылку"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
