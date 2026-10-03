import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/require-role";

export type GlobalChangeLogFilters = { actor?: string; entity?: string; from?: string; to?: string };

/** Global audit reader, separate from entity/finance history and audit writers. */
export async function listGlobalChangeLog({ actor, entity, from, to }: GlobalChangeLogFilters) {
  await requireRole(["ADMIN"]);
  const where = {
    ...(actor ? { OR: [
      { actorName: { contains: actor, mode: "insensitive" as const } },
      { actorId: { contains: actor, mode: "insensitive" as const } },
    ] } : {}),
    ...(entity ? { entity: { contains: entity, mode: "insensitive" as const } } : {}),
    ...(from || to ? { createdAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
    } } : {}),
  };
  return prisma.changeLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
}
