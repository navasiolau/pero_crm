"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";

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
  children,
  confirmDisabled = false,
}: {
  entityLabel: string; // "задачу", "работу", "файл", …
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<boolean | void>;
  warning?: string; // дополнительное предупреждение, если есть
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent initialFocus={heading}>
        <DialogHeader>
          <DialogTitle ref={heading} tabIndex={-1} className="outline-none">Подтверждение удаления</DialogTitle>
          <DialogDescription>
            Вы уверены, что хотите удалить {entityLabel}? Действие необратимое.
            {warning ? ` ${warning}` : ""}
          </DialogDescription>
        </DialogHeader>
        {children}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={pending || confirmDisabled}
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
