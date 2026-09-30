"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";

import { getProductHeroImageState, getProductSketchPreviewSource, isCompletedProductHeroImageFailure, type SketchFilePreview } from "@/lib/product-hero";
import { cn } from "@/lib/utils";

export function ProductHeroImage({
  sketch,
  alt,
  className,
  preferThumbnail = true,
}: {
  sketch: SketchFilePreview;
  alt?: string;
  className?: string;
  preferThumbnail?: boolean;
}) {
  const src = getProductSketchPreviewSource(sketch, preferThumbnail);
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
        Эскиз не удалось загрузить
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
      onError={() => setFailedSrc(src)}
    />
  );
}
