"use client";

import type { ComponentProps } from "react";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

/** touch-action:none только на ручке — остальная карточка допускает свайп. */
export function DragHandle({
  label,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      {...props}
      variant="ghost"
      size="icon"
      aria-label={`Перетащить ${label}`}
      className="absolute top-1 right-1 z-10 cursor-grab touch-none active:cursor-grabbing"
      onClick={(event) => event.stopPropagation()}
    >
      <GripVertical className="size-4" />
    </Button>
  );
}
