import type { PrismaClient } from "@prisma/client";
import { FINANCE_ROLES, hasAnyRole, type Role } from "@/lib/roles";
import type { StockMaterialOption } from "./contracts";
export async function listStockReceiptMaterials(actor: { roles: Role[] }, db: Pick<PrismaClient, "material">, query = "", limit?: number): Promise<StockMaterialOption[]> {
  if (!hasAnyRole(actor.roles, FINANCE_ROLES)) throw Error("Недостаточно прав");
  const q = query.trim().slice(0,100);
  const materials = await db.material.findMany({ where: { active: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}) },
    select: { id: true, name: true, measurementUnit: { select: { name: true } }, sku: true }, orderBy: { name: "asc" }, take: limit });
  return materials.map(row => ({ id: row.id, name: row.name, sku: row.sku, unit: row.measurementUnit.name }));
}
