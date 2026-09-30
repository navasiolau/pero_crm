import type { Prisma } from "@prisma/client";

import { fileVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";

const sketchFileSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  hasThumb: true,
} satisfies Prisma.FileSelect;

export function productSketchProjection(actor: VisibilityActor) {
  return {
    where: fileVisibilityWhere(actor),
    select: sketchFileSelect,
  } satisfies Prisma.Product$sketchFileArgs;
}
