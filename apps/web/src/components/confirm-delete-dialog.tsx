"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Единое окно подтверждения удаления для всего приложения:
// «Вы уверены, что хотите удалить <сущность>?» — применять везде.
export function ConfirmDeleteDialog({
  entityLabel,
  open,
  onOpenChange,
  onConfirm,
  warning,
}: {
  entityLabel: string; // "задачу", "работу", "файл", …
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<boolean | void>;
  warning?: string; // дополнительное предупреждение, если есть
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подтверждение удаления</DialogTitle>
          <DialogDescription>
            Вы уверены, что хотите удалить {entityLabel}? Действие необратимое.
            {warning ? ` ${warning}` : ""}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await onConfirm();
                if (result === false) return; // ошибка уже показана снаружи
                onOpenChange(false);
              })
            }
          >
            {pending ? "Удаление…" : "Удалить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
