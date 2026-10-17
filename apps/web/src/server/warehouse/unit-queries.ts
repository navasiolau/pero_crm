import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasAnyRole, OFFICE_ROLES, WAREHOUSE_UNIT_ADMIN_ROLES } from "@/lib/roles";
import type { MaterialUnitOption, MaterialUnitView } from "./unit-contracts";

export async function listMaterialUnitOptions(actor: { roles: Role[] }, db: Pick<Prisma.TransactionClient, "materialUnit"> = prisma): Promise<MaterialUnitOption[]> {
  if (!hasAnyRole(actor.roles, OFFICE_ROLES)) throw Error("Недостаточно прав");
  return db.materialUnit.findMany({ select: { id: true, name: true }, orderBy: [{ createdAt: "asc" }, { name: "asc" }] });
}
export async function listMaterialUnits(actor: { roles: Role[] }, db: Prisma.TransactionClient = prisma): Promise<MaterialUnitView[]> {
  if (!hasAnyRole(actor.roles, WAREHOUSE_UNIT_ADMIN_ROLES)) throw Error("Недостаточно прав");
  const units = await db.materialUnit.findMany({ select: { id: true, name: true, _count: { select: { materials: true } } }, orderBy: [{ createdAt: "asc" }, { name: "asc" }] });
  return units.map(unit => ({ id: unit.id, name: unit.name, materialCount: unit._count.materials }));
}
