import type { Prisma } from "@prisma/client";
import { planQuantityChange } from "@/lib/product-quantity";

// Все writers плана/выдачи сначала блокируют изделие, затем его строки.
export async function lockProductRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} FOR UPDATE`;
}

export async function recalculateQuantity(tx: Prisma.TransactionClient, product: { id: string; quantity: number }, count: number) {
  await tx.$queryRaw`SELECT id FROM "Work" WHERE "productId" = ${product.id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "ProjectMaterial" WHERE "productId" = ${product.id} ORDER BY id FOR UPDATE`;
  const works = await tx.work.findMany({ where: { productId: product.id },
    include: { tasks: { select: { quantity: true, allocationGroupId: true } } } });
  const materials = await tx.projectMaterial.findMany({ where: { productId: product.id }, include: { material: { select: { name: true } } } });
  const plan = planQuantityChange(product.quantity, count, works, materials);
  for (const { id, ...data } of plan.works) await tx.work.update({ where: { id }, data });
  for (const { id, ...data } of plan.materials) await tx.projectMaterial.update({ where: { id }, data });
  return plan;
}
