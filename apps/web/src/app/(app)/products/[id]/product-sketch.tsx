"use client";

import { FileImage } from "lucide-react";

import { ProductHeroImage } from "@/components/product-hero-image";
import { Card, CardContent } from "@/components/ui/card";
import { useFileViewer } from "@/components/file-viewer";
import { getProductHeroLayout, getProductSketchPreviewSource, type SketchFilePreview } from "@/lib/product-hero";
import { cn } from "@/lib/utils";

// Эскиз и техническое описание — единый крупный блок карточки изделия.
export function ProductSketch({
  sketch,
  description,
}: {
  sketch: SketchFilePreview | null;
  description: string | null;
}) {
  const { open, viewer } = useFileViewer();
  const hasDescription = Boolean(description?.trim());
  const hasImage = Boolean(getProductSketchPreviewSource(sketch, false));
  const layout = getProductHeroLayout(hasDescription, hasImage);

  if (layout === "empty") return null;

  return (
    <section
      data-slot="product-hero"
      data-layout={layout}
      className={cn(
        "grid min-w-0 grid-cols-1 gap-4",
        layout === "split" && "lg:grid-cols-2",
      )}
    >
      {hasImage && sketch ? (
        <Card className={cn("order-1 min-w-0", layout === "split" && "lg:order-2")}>
          <CardContent className="flex min-w-0 flex-col gap-2 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <FileImage className="size-4 shrink-0 text-muted-foreground" />
              <span>Эскиз изделия</span>
            </div>
            <button
              type="button"
              className="flex min-h-64 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg bg-muted/30"
              onClick={() => open(sketch)}
              aria-label="Открыть оригинал эскиза"
            >
              <ProductHeroImage
                sketch={sketch}
                preferThumbnail={false}
                className="max-h-[75vh] w-full"
              />
            </button>
            <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
              <span className="truncate text-muted-foreground">{sketch.fileName}</span>
              <button
                type="button"
                className="shrink-0 text-foreground underline-offset-2 hover:underline"
                onClick={() => open(sketch)}
              >
                Открыть оригинал
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {hasDescription && description ? (
        <Card className={cn("order-2 min-w-0", layout === "split" && "lg:order-1")}>
          <CardContent className="min-w-0 p-4 text-sm">
            <div className="mb-1 text-muted-foreground">Техническое описание</div>
            <div className="whitespace-pre-wrap break-words">{description}</div>
          </CardContent>
        </Card>
      ) : null}

      {viewer}
    </section>
  );
}
