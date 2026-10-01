"use client";

import * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatAmount } from "@/lib/format";
import { getKanbanHeroHeights, getProductSketchPreviewSource, type SketchFilePreview } from "@/lib/product-hero";
import { daysOnStatus } from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { ProductHeroImage } from "./product-hero-image";

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
}: {
  product: ProductKanbanCardData;
  currency: string;
  showAmount: boolean;
  projectContext?: string;
  dragging?: boolean;
}) {
  const infoRef = useRef<HTMLDivElement>(null);
  const [infoHeight, setInfoHeight] = useState(0);
  const sketch = product.sketchFile;
  const imageSource = getProductSketchPreviewSource(sketch);
  const heights = getKanbanHeroHeights(infoHeight);
  const days = daysOnStatus(product.statusChangedAt);

  useLayoutEffect(() => {
    const node = infoRef.current;
    if (!node || !imageSource || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const size = entry?.borderBoxSize;
      const measured = size?.[0]?.blockSize;
      const nextHeight = getKanbanHeroHeights(measured ?? node.getBoundingClientRect().height).infoHeight;
      setInfoHeight((current) => current === nextHeight ? current : nextHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [imageSource]);

  const style = imageSource && heights.infoHeight > 0
    ? { height: `${heights.cardHeight + 2}px` }
    : undefined;

  return (
    <Card
      data-slot="product-kanban-card"
      data-has-image={imageSource ? "true" : "false"}
      className={cn("cursor-pointer select-none gap-0 overflow-hidden py-0", dragging && "rotate-2 shadow-lg")}
      style={style}
    >
      {imageSource && sketch ? (
        <div
          data-slot="product-kanban-image"
          className="relative w-full shrink-0 overflow-hidden bg-muted/30"
          style={{ height: heights.infoHeight > 0 ? `${heights.imageHeight}px` : "8rem" }}
        >
          <ProductHeroImage
            sketch={sketch}
            className="absolute inset-0 h-full w-full p-2"
          />
        </div>
      ) : null}

      <div ref={infoRef} data-slot="product-kanban-info" className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2 pr-10">
          <span className="break-all text-sm font-medium">{product.number}</span>
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
    </Card>
  );
}
