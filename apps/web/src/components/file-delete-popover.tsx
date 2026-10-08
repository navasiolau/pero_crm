"use client";

import * as React from "react";
import {useRef, useState} from "react";
import {Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger} from "@/components/ui/popover";

export type FileDeleteResult = {ok: boolean; error?: string};

export function FileDeletePopover({fileName, disabled = false, onConfirm, onBusyChange}: {
  fileName: string;
  disabled?: boolean;
  onConfirm: () => Promise<FileDeleteResult>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);

  async function confirm() {
    if (disabled || active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    onBusyChange?.(true);
    try {
      const result = await onConfirm();
      if (!result.ok) {
        setError(result.error ?? "Не удалось удалить файл");
        return;
      }
      setOpen(false);
    } catch {
      setError("Не удалось подтвердить удаление. Повторите попытку.");
    } finally {
      active.current = false;
      setPending(false);
      onBusyChange?.(false);
    }
  }

  return <Popover open={open} onOpenChange={(next, details) => {
    if (active.current || (next && disabled)) {
      details.cancel();
      return;
    }
    setOpen(next);
    setError(null);
  }}>
    <PopoverTrigger disabled={disabled || pending} onClick={event => event.stopPropagation()}
      aria-label={`Удалить файл ${fileName}`}
      render={<Button type="button" variant="ghost" size="icon-sm" className="size-11 text-muted-foreground sm:size-7" />}>
      <Trash2 className="size-4" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverContent align="end" className="max-w-[calc(100vw-2rem)]" initialFocus={cancel}
      onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} aria-busy={pending}>
      <PopoverTitle>Подтверждение удаления</PopoverTitle>
      <PopoverDescription className="break-all">Удалить файл «{fileName}»? Это действие нельзя отменить.</PopoverDescription>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button ref={cancel} type="button" variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button>
        <Button type="button" variant="destructive" size="sm" disabled={disabled || pending} onClick={() => void confirm()}>{pending ? "Удаление…" : "Удалить"}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}