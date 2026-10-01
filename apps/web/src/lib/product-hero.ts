export type SketchFilePreview = {
  id: string;
  fileName: string;
  mimeType: string;
  hasThumb: boolean;
};

export type ProductHeroLayout = "split" | "description" | "image" | "empty";
export type ProductHeroImageState = "empty" | "image" | "error";

export function getProductHeroLayout(hasDescription: boolean, hasImage: boolean): ProductHeroLayout {
  if (hasDescription && hasImage) return "split";
  if (hasDescription) return "description";
  if (hasImage) return "image";
  return "empty";
}

export function getProductSketchPreviewSource(
  sketch: SketchFilePreview | null | undefined,
  preferThumbnail = true,
): string | null {
  if (!sketch || !sketch.mimeType.startsWith("image/")) return null;
  const path = `/api/files/${encodeURIComponent(sketch.id)}`;
  return preferThumbnail && sketch.hasThumb ? `${path}?thumb=1` : path;
}

export function getProductHeroImageState(
  source: string | null,
  failedSource: string | null,
): ProductHeroImageState {
  if (!source) return "empty";
  return failedSource === source ? "error" : "image";
}

export function isCompletedProductHeroImageFailure(complete: boolean, naturalWidth: number): boolean {
  return complete && naturalWidth === 0;
}

export function getKanbanHeroHeights(infoBlockHeight: number): {
  infoHeight: number;
  imageHeight: number;
  cardHeight: number;
} {
  const infoHeight = Number.isFinite(infoBlockHeight) ? Math.max(0, Math.ceil(infoBlockHeight)) : 0;
  return { infoHeight, imageHeight: infoHeight * 2, cardHeight: infoHeight * 3 };
}
