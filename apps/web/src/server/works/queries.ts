import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canCreateOrdinaryWork, canEditOrdinaryWork } from "@/lib/ordinary-work-access";
import { allocatedWorkQuantity, quantityAtoms, quantityFromAtoms } from "@/lib/work-shares";
import { productVisibilityWhere, resolveVisibilityActor, workVisibilityWhere } from "@/server/access/visibility";
import { canAddProductWork } from "./access";
import { isOrdinaryWork, workPlanRevision } from "./plan";

export type WorkOperation = { revision: string; canEdit: boolean; canChangePrice: boolean;
  priceItemId: string | null; allocated: string; remaining: string };
type WorkDatabase=Pick<Prisma.TransactionClient,"user"|"product"|"work"|"task"|"payrollEntry"|"productPercentageParticipant"|"priceItem">;

export async function listWorkPriceOptions(actor: { id: string; roles: Role[] }, productId: string, db:WorkDatabase=prisma) {
  if (!canCreateOrdinaryWork(actor.roles)) return [];
  const current = await db.user.findUnique({ where: { id: actor.id }, select: { id: true, roles: true, active: true } });
  if (!current?.active || !canCreateOrdinaryWork(current.roles)) return [];
  const visibility = await resolveVisibilityActor(db, current);
  const product = await db.product.findFirst({ where: { id: productId, AND: [productVisibilityWhere(visibility)] }, select: { id: true, status: true } });
  if (!product || !canAddProductWork(current.roles, product.status)) return [];
  return db.priceItem.findMany({ where: { active: true }, select: { id: true, name: true, unit: true, price: true }, orderBy: { name: "asc" } });
}

// Коллеги не попадают в DTO: возвращаются только общий занятый объём и grant.
export async function listProductWorkOperations(actor: { id: string; roles: Role[] }, productId: string, db:WorkDatabase=prisma): Promise<Record<string, WorkOperation>> {
  const current = await db.user.findUnique({ where: { id: actor.id }, select: { id: true, roles: true, active: true } });
  if (!current?.active) return {};
  const visibility = await resolveVisibilityActor(db, current);
  const product = await db.product.findFirst({ where: { id: productId, AND: [productVisibilityWhere(visibility)] }, select: { id: true, status: true } });
  if (!product) return {};
  const works = await db.work.findMany({ where: { productId, AND: [workVisibilityWhere(visibility)] }, include: {
    tasks: { select: { id: true, quantity: true, allocationGroupId: true } },
    _count: { select: { paymentConversions: true, settlementShares: true } },
  } });
  const entries = await db.payrollEntry.findMany({ where: { workId: { in: works.map(work => work.id) } }, select: { workId: true } });
  const accrued = new Set(entries.map(entry => entry.workId));
  const result: Record<string, WorkOperation> = {};
  for (const work of works) {
    if (!isOrdinaryWork(work) || work._count.paymentConversions || work._count.settlementShares) continue;
    if (work.tasks.some(task => task.quantity === null)) continue;
    try {
      const allocated = allocatedWorkQuantity(work.tasks), remaining = quantityAtoms(work.quantity) - quantityAtoms(allocated);
      if (remaining < BigInt(0)) continue;
      result[work.id] = { revision: workPlanRevision(work), canEdit: canEditOrdinaryWork(current.roles, product.status) && work.priceSnapshot !== null,
        canChangePrice: work.tasks.length === 0 && !accrued.has(work.id), priceItemId: work.priceItemId,
        allocated, remaining: quantityFromAtoms(remaining) };
    } catch { /* Не угадываем неизвестный исторический объём. */ }
  }
  return result;
}
