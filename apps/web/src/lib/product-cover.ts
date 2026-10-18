import type { ProductStatus, Role } from "@prisma/client";
import type { ProductDraftAccessContext } from "./product-drafts";

import { canEditProductTechnicalBlock } from "@/server/access/visibility";

export type CoverActor = {
  id: string;
  roles: readonly Role[];
  engineeringParticipantProductIds?: string[];
};

export type CoverProduct = ProductDraftAccessContext & {
  id: string;
  projectId: string;
  status: ProductStatus;
  engineerId: string | null;
  sketchFileId: string | null;
};

export type CoverFile = {
  id: string;
  projectId: string;
  productId: string | null;
  mimeType: string;
};

const COVER_IMAGE_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif",
  "image/gif", "image/heic", "image/heif", "image/bmp", "image/x-ms-bmp",
]);

/** Keep the technical-edit grant: management wins, engineering is DESIGN-only. */
export function canSetProductCover(actor: CoverActor, product: CoverProduct): boolean {
  return canEditProductTechnicalBlock({ ...actor, roles: [...actor.roles] }, product);
}

export function isCoverImageMime(mimeType: string): boolean {
  return COVER_IMAGE_MIME.has(mimeType.toLowerCase());
}

export function validateProductCoverFile(product: CoverProduct, file: CoverFile): string | null {
  if (file.projectId !== product.projectId) return "Файл принадлежит другому проекту";
  if (file.productId !== product.id) return "Файл не прикреплён к этому изделию";
  if (!isCoverImageMime(file.mimeType)) return "Нужно изображение поддерживаемого формата";
  return null;
}
