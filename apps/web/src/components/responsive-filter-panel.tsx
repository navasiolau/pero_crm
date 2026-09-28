"use client";

import { useState, type ReactNode } from "react";
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
}: {
  children: ReactNode;
  active: boolean;
  pending?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(true)}
        aria-label="Фильтры"
        className="self-start"
      >
        <SlidersHorizontal className="size-4" /> Фильтры
        {active && (
          <span className="size-2 rounded-full bg-primary" aria-label="Есть активные фильтры" />
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
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
            <Button onClick={() => setOpen(false)}>Показать результаты</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
