import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditProductTechnicalBlock, fileVisibilityWhere, productVisibilityWhere,
  resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";

type Reader = Pick<Prisma.TransactionClient, "task" | "product" | "file">;

/** Selector for already uploaded same-Product raster images; never returns storage URLs. */
export async function listFinishSampleFilesFor(db: Reader, actor: VisibilityActor, productId: string) {
  const visibleActor = await resolveVisibilityActor(db, actor);
  const product = await db.product.findFirst({ where: { AND: [{ id: productId }, productVisibilityWhere(visibleActor)] },
    select: { id: true, projectId: true, engineerId: true, status: true } });
  if (!product || !canEditProductTechnicalBlock(visibleActor, product)) return [];
  return db.file.findMany({ where: { AND: [
    { productId: product.id, projectId: product.projectId, mimeType: { in: ["image/jpeg", "image/png", "image/webp"] } },
    fileVisibilityWhere(visibleActor),
  ] }, orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, mimeType: true } });
}

export async function listFinishSampleFiles(actor: VisibilityActor, productId: string) {
  return listFinishSampleFilesFor(prisma, actor, productId);
}
