"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatAmount } from "@/lib/format";
import { getProductSketchPreviewSource, type SketchFilePreview } from "@/lib/product-hero";
import { daysOnStatus } from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { ProductHeroImage } from "./product-hero-image";
import { useFileViewer } from "./file-viewer";
import { CardNumber } from "./card-number";
import { openProductCardCover, type ProductCardCoverAction } from "@/lib/product-card-cover-action";

export interface ProductKanbanCardData {
  number: string;
  title: string;
  statusChangedAt: string;
  expectedPrice: string | null;
  quantity?: number;
  engineerName: string | null;
  sketchFile: SketchFilePreview | null;
}

function daysBadgeClass(days: number): string {
  if (days >= 14) return "bg-destructive/15 text-destructive";
  if (days >= 7) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

export function ProductKanbanCard({
  product,
  currency,
  showAmount,
  projectContext,
  dragging = false,
  coverAction,
}: {
  product: ProductKanbanCardData;
  currency: string;
  showAmount: boolean;
  projectContext?: string;
  dragging?: boolean;
  coverAction?: ProductCardCoverAction;
}) {
  const fileViewer = useFileViewer();
  const sketch = product.sketchFile;
  const imageSource = getProductSketchPreviewSource(sketch);
  const days = daysOnStatus(product.statusChangedAt);

  return (
    <><Card
      data-slot="product-kanban-card"
      data-has-image={imageSource ? "true" : "false"}
      className={cn("cursor-pointer select-none gap-0 overflow-hidden py-0", dragging && "rotate-2 shadow-lg")}
    >
      {imageSource && sketch ? (
        <div
          data-slot="product-kanban-image"
          className="relative aspect-[3/4] w-full shrink-0 overflow-hidden bg-muted/30"
        >
          <button type="button" className="block h-full w-full" aria-label={coverAction?.type==="navigate"?`Открыть изделие ${product.title}`:`Открыть изображение ${product.title} на весь экран`} disabled={dragging}
            onClick={event => { event.preventDefault(); event.stopPropagation(); openProductCardCover(coverAction,()=>fileViewer.open(sketch),dragging); }}>
          <ProductHeroImage
            sketch={sketch}
            className="h-full w-full object-cover object-center"
          />
          </button>
        </div>
      ) : null}

      <div data-slot="product-kanban-info" className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2 pr-10">
          <span className="break-all text-sm"><CardNumber>{product.number}</CardNumber></span>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {(product.quantity ?? 1) > 1 && <Badge variant="secondary" aria-label={`Количество: ${product.quantity} шт.`}>×{product.quantity}</Badge>}
          <Badge variant="secondary" className={cn("shrink-0 text-xs", daysBadgeClass(days))}>
            {days} дн.
          </Badge>
          </div>
        </div>
        <div className="break-words text-sm">{product.title}</div>
        {projectContext ? (
          <div className="break-words text-xs text-muted-foreground">{projectContext}</div>
        ) : null}
        {product.engineerName ? (
          <div className="break-words text-xs text-muted-foreground">
            Инженер: {product.engineerName}
          </div>
        ) : null}
        {showAmount ? (
          <div className="text-xs text-muted-foreground">
            {formatAmount(product.expectedPrice, currency)} / шт.
          </div>
        ) : null}
      </div>
    </Card>{fileViewer.viewer}</>
  );
}
