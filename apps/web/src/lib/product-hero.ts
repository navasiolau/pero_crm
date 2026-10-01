import type { Role } from "@prisma/client";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";

export type SketchFilePreview = {
  id: string;
  fileName: string;
  mimeType: string;
  hasThumb: boolean;
};

export type ProductHeroLayout = "split" | "description" | "image" | "empty";
export type ProductHeroImageState = "empty" | "image" | "error";
export type ProductCoverPreviewKind = "card" | "cover" | "original";
export type ProductCoverChoice = SketchFilePreview & { productId: string; projectId: string };
export type ProductCoverAction = "fullscreen" | "replace";

export function getProductHeroLayout(hasDescription: boolean, hasImage: boolean): ProductHeroLayout {
  if (hasDescription && hasImage) return "split";
  if (hasDescription) return "description";
  if (hasImage) return "image";
  return "empty";
}

export function getProductSketchPreviewSource(
  sketch: SketchFilePreview | null | undefined,
  preview: ProductCoverPreviewKind = "card",
): string | null {
  if (!sketch || !sketch.mimeType.startsWith("image/")) return null;
  const path = `/api/files/${encodeURIComponent(sketch.id)}`;
  return preview === "original" ? path : `${path}?preview=${preview}`;
}

export function getProductCoverLayout(hasCover: boolean): "cover" | "full-width" {
  return hasCover ? "cover" : "full-width";
}

export function getProductCoverActions(hasCover: boolean, canReplace: boolean): ProductCoverAction[] {
  return [
    ...(hasCover ? ["fullscreen" as const] : []),
    ...(canReplace ? ["replace" as const] : []),
  ];
}

export function canReplaceProductCover(roles: readonly Role[], canEditTechnicalBlock: boolean): boolean {
  if (!canEditTechnicalBlock) return false;
  return hasAnyRole([...roles], MANAGER_ROLES) || hasRole([...roles], "ENGINEER");
}

export function getAttachedProductCoverChoices(
  files: readonly ProductCoverChoice[],
  productId: string,
  projectId: string,
): ProductCoverChoice[] {
  return files.filter((file) => file.productId === productId && file.projectId === projectId && file.mimeType.startsWith("image/"));
}

export function getProductCoverPreviewUrl(
  sketch: SketchFilePreview | null | undefined,
  preview: ProductCoverPreviewKind,
): string | null {
  return getProductSketchPreviewSource(sketch, preview);
}

export function keepCurrentCoverOnFailure(
  currentFileId: string | null,
  nextFileId: string,
  result: { ok: boolean },
): string | null {
  return result.ok ? nextFileId : currentFileId;
}

export function refreshAfterCoverMutation(result: { ok: boolean }, refresh?: () => void): boolean {
  if (!result.ok) return false;
  refresh?.();
  return true;
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
