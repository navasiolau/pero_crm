import { prisma } from "@/lib/prisma";
import type { Prisma, Role } from "@prisma/client";
import { canManageFinishCatalog, canReadFinishCatalog } from "@/lib/finish-catalog-access";
import { finishView } from "./contracts";
export async function listFinishesFor(actor: { roles: readonly Role[] }, database: Pick<Prisma.TransactionClient, "finish"> = prisma) {
  if (!canReadFinishCatalog(actor.roles)) throw Error("Недостаточно прав");
  const rows = await database.finish.findMany({ where: canManageFinishCatalog(actor.roles) ? {} : { active: true }, include:{sampleAsset:{select:{id:true,fileName:true,mimeType:true,size:true,deletedAt:true}}},orderBy: [{ kind: "asc" }, { code: "asc" }] });
  return rows.map(finishView);
}
