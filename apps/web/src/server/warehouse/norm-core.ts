import {liveProductWhere} from "@/server/access/live-entities";
import type { Prisma } from "@prisma/client";
import { decimalAtoms, decimalText, existingNorm, inputNorm, scaleNorm } from "@/lib/product-quantity";
import { lockProductRow } from "@/server/products/quantity-core";
import {warehouseMetadataGate} from './gate';

export async function lockMaterialProduct(tx: Prisma.TransactionClient, id: string) {
  await warehouseMetadataGate(tx);
  const line = await tx.projectMaterial.findUnique({ where: {product:liveProductWhere, id }, select: { productId: true } });
  if (!line) throw new Error("Строка потребности не найдена");
  await lockProductRow(tx, line.productId);
}

export async function addMaterialNorm(tx: Prisma.TransactionClient,
  data: { productId: string; materialId: string; quantity?: number; quantityPerUnit?: number; comment?: string }, userId: string) {
  await warehouseMetadataGate(tx);
  await lockProductRow(tx, data.productId);
  const product = await tx.product.findUnique({ where: {...liveProductWhere, id: data.productId }, select: { id: true, number: true, projectId: true, quantity: true } });
  if (!product) throw new Error("Изделие не найдено");
  const material = await tx.material.findUnique({ where: { id: data.materialId } });
  if (!material?.active) throw new Error("Материал не найден");
  const norm = inputNorm(data, product.quantity, 3, 12);
  const previous = await tx.projectMaterial.findUnique({ where: {product:liveProductWhere, productId_materialId: { productId: product.id, materialId: material.id } } });
  const atoms = decimalAtoms(norm, 3, 12) + (previous ? decimalAtoms(existingNorm(previous.quantityPerUnit, previous.quantity, product.quantity), 3, 12) : BigInt(0));
  const quantityPerUnit = decimalText(atoms, 3);
  const quantity = scaleNorm(quantityPerUnit, product.quantity, 3, 12);
  const line = await tx.projectMaterial.upsert({
    where: { productId_materialId: { productId: product.id, materialId: material.id } },
    create: { productId: product.id, materialId: material.id, quantity, quantityPerUnit,
      comment: data.comment?.trim() || null, createdById: userId },
    update: { quantity, quantityPerUnit },
  });
  return { line, product, material };
}

export async function updateMaterialNorm(tx: Prisma.TransactionClient,
  data: { id: string; quantity?: number; quantityPerUnit?: number; comment?: string }) {
  await lockMaterialProduct(tx, data.id);
  const line = await tx.projectMaterial.findUnique({ where: {product:liveProductWhere, id: data.id }, include: { product: { select: { projectId: true, quantity: true } } } });
  if (!line) throw new Error("Строка не найдена");
  const quantityPerUnit = inputNorm(data, line.product.quantity, 3, 12);
  const quantity = scaleNorm(quantityPerUnit, line.product.quantity, 3, 12);
  if (decimalAtoms(quantity, 3, 12) < decimalAtoms(line.issuedQty, 3, 12))
    throw new Error(`Нельзя поставить меньше уже выданного (${line.issuedQty})`);
  await tx.projectMaterial.update({ where: { id: line.id }, data: { quantity, quantityPerUnit, comment: data.comment?.trim() || null } });
  return { line, quantity, quantityPerUnit };
}
