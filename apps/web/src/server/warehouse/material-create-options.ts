import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasAnyRole, WAREHOUSE_MANAGE_ROLES } from "@/lib/roles";
import { listMaterialUnitOptions } from "./unit-queries";
import type { MaterialCreateOptions } from "./material-contracts";

export async function loadMaterialCreateOptions(actor: { roles: Role[] }, db: Pick<Prisma.TransactionClient, "materialUnit" | "materialCategory"> = prisma): Promise<MaterialCreateOptions | undefined> {
  if (!hasAnyRole(actor.roles, WAREHOUSE_MANAGE_ROLES)) return undefined;
  const [units, categories] = await Promise.all([
    listMaterialUnitOptions(actor, db),
    db.materialCategory.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return { units, categories };
}
