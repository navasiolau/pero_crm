import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { productVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";
import { validateCompositionTree } from "@/lib/composition-tree";

type Reader = Pick<Prisma.TransactionClient, "task" | "product" | "productCompositionRevision" | "productCompositionItem">;

/** Every revision lookup starts with the current Product visibility grant. */
export async function getProductCompositionFor(db: Reader, actor: VisibilityActor, productId: string, selectedRevisionId?: string) {
  const visibleActor = await resolveVisibilityActor(db, actor);
  const product = await db.product.findFirst({ where: { AND: [{ id: productId }, productVisibilityWhere(visibleActor)] },
    select: { id: true, number: true } });
  if (!product) return null;
  const revisions = await db.productCompositionRevision.findMany({ where: { productId },
    orderBy: [{ revisionNo: "desc" }, { createdAt: "desc" }],
    select: { id: true, status: true, revisionNo: true, baseRevisionId: true, draftVersion: true, createdAt: true,
      createdById: true, confirmedAt: true, confirmedById: true } });
  const draft = revisions.find((row) => row.status === "DRAFT") ?? null;
  const current = revisions.find((row) => row.status === "CONFIRMED") ?? null;
  const selected = selectedRevisionId
    ? revisions.find((row) => row.id === selectedRevisionId) ?? null
    : current ?? draft;
  if (selectedRevisionId && !selected) return null;
  const rows = selected ? await db.productCompositionItem.findMany({ where: { revisionId: selected.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] }) : [];
  const calculated = validateCompositionTree(rows);
  return { productId: product.id, productNumber: product.number,
    draft: draft && { ...draft, createdAt: draft.createdAt.toISOString(), confirmedAt: draft.confirmedAt?.toISOString() ?? null },
    current: current && { ...current, createdAt: current.createdAt.toISOString(), confirmedAt: current.confirmedAt?.toISOString() ?? null },
    history: revisions.filter((row) => row.status === "CONFIRMED").map((row) => ({ ...row,
      createdAt: row.createdAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null })),
    selected: selected && { ...selected, createdAt: selected.createdAt.toISOString(), confirmedAt: selected.confirmedAt?.toISOString() ?? null },
    items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      effectiveQuantity: calculated.effectiveQuantity.get(row.id)!, depth: calculated.depth.get(row.id)! })) };
}

export async function getProductComposition(actor: VisibilityActor, productId: string, selectedRevisionId?: string) {
  return getProductCompositionFor(prisma, actor, productId, selectedRevisionId);
}
