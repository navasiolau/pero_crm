"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";

/** Одни поля и одно состояние: mobile Sheet не дублирует desktop inputs. */
export function ResponsiveFilterPanel({
  children,
  active,
  pending,
  onModalActiveChange,
}: {
  children: ReactNode;
  active: boolean;
  pending?: boolean;
  onModalActiveChange?: (active: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isMobile) onModalActiveChange?.(false);
    else if (open) onModalActiveChange?.(true);
    // Обычное закрытие ждёт onOpenChangeComplete; возврат на mobile
    // с ещё открытой панелью заново блокирует фоновую прокрутку.
  }, [isMobile, open, onModalActiveChange]);
  useEffect(() => () => onModalActiveChange?.(false), [onModalActiveChange]);
  function changeOpen(next: boolean) {
    if (next) onModalActiveChange?.(true);
    setOpen(next);
  }
  if (!isMobile) {
    return (
      <div data-pending={pending || undefined} className="flex flex-wrap items-end gap-2">
        {children}
      </div>
    );
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => changeOpen(true)}
        aria-label="Фильтры"
        className="self-start"
      >
        <SlidersHorizontal className="size-4" /> Фильтры
        {active && (
          <span className="size-2 rounded-full bg-primary" aria-label="Есть активные фильтры" />
        )}
      </Button>
      <Sheet open={open} onOpenChange={changeOpen}
        onOpenChangeComplete={(next) => { if (!next) onModalActiveChange?.(false); }}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] rounded-t-xl"
          data-pending={pending || undefined}
        >
          <SheetHeader className="shrink-0 pr-14">
            <SheetTitle>Фильтры</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4 [&>*]:w-full [&_[data-slot=select-trigger]]:w-full">
            {children}
          </div>
          <SheetFooter className="shrink-0 border-t bg-popover">
            <Button onClick={() => changeOpen(false)}>Показать результаты</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
