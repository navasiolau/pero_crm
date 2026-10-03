import { prisma } from "@/lib/prisma";
import type { Prisma, Role } from "@prisma/client";
import { canManageFinishCatalog, canReadFinishCatalog } from "@/lib/finish-catalog-access";
import { finishView } from "./contracts";
export async function listFinishesFor(actor: { roles: readonly Role[] }, database: Pick<Prisma.TransactionClient, "finish"> = prisma) {
  if (!canReadFinishCatalog(actor.roles)) throw Error("Недостаточно прав");
  const rows = await database.finish.findMany({ where: canManageFinishCatalog(actor.roles) ? {} : { active: true }, orderBy: [{ kind: "asc" }, { code: "asc" }] });
  return rows.map(finishView);
}
