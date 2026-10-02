"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";

import { getProductHeroImageState, getProductSketchPreviewSource, isCompletedProductHeroImageFailure, type ProductCoverPreviewKind, type SketchFilePreview } from "@/lib/product-hero";
import { cn } from "@/lib/utils";

export function ProductHeroImage({
  sketch,
  alt,
  className,
  preview = "card",
  priority = false,
  errorDisplay = "message",
}: {
  sketch: SketchFilePreview;
  alt?: string;
  className?: string;
  preview?: Exclude<ProductCoverPreviewKind, "original">;
  priority?: boolean;
  errorDisplay?: "message" | "icon";
}) {
  const src = getProductSketchPreviewSource(sketch, preview);
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const state = getProductHeroImageState(src, failedSrc);

  useEffect(() => {
    const image = imageRef.current;
    if (!src || !image || image.getAttribute("src") !== src) return;
    if (isCompletedProductHeroImageFailure(image.complete, image.naturalWidth)) {
      setFailedSrc(src);
    }
  }, [src]);

  if (state !== "image" || !src) {
    return (
      <div
        role="img"
        aria-label="Эскиз не загрузился"
        className={cn("flex items-center justify-center bg-muted/60 p-4 text-sm text-muted-foreground", className)}
      >
        <ImageOff aria-hidden="true" className="size-6 shrink-0" />
        {errorDisplay === "icon" ? (
          <span className="sr-only">Обложка не загрузилась</span>
        ) : (
          <span className="ml-2">Эскиз не удалось загрузить</span>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={src}
      alt={alt ?? sketch.fileName}
      className={cn("object-contain", className)}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
}
