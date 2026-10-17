import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { clientVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";
import { publicClientSelect } from "./projection";

export interface ClientDirectoryRow {
  id: string;
  name: string;
  lastName: string | null;
  middleName: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  comment: string | null;
  passportNumber?: string | null;
  passportIssuedBy?: string | null;
  projects: { id: string; number: string; title: string }[];
  projectsCount: number;
}

export async function listClientDirectory(actor: VisibilityActor, db: PrismaClient = prisma): Promise<ClientDirectoryRow[]> {
  actor = await resolveVisibilityActor(db, actor);
  const canViewPassport = hasAnyRole(actor.roles, MANAGER_ROLES);
  const clients = await db.client.findMany({
    where: clientVisibilityWhere(actor),
    select: {
      ...publicClientSelect,
      ...(canViewPassport ? { passportNumber: true, passportIssuedBy: true } as const : {}),
      projects: {
        where: projectVisibilityWhere(actor),
        select: { id: true, number: true, title: true },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { projects: { where: projectVisibilityWhere(actor) } } },
    },
    orderBy: { name: "asc" },
  });
  // DTO заново собирается на сервере; даже лишние поля адаптера не уходят в UI.
  return clients.map(client => ({
    id: client.id, name: client.name, lastName: client.lastName, middleName: client.middleName,
    phone: client.phone, email: client.email, address: client.address, comment: client.comment,
    ...(canViewPassport ? { passportNumber: client.passportNumber, passportIssuedBy: client.passportIssuedBy } : {}),
    projects: client.projects, projectsCount: client._count.projects,
  }));
}
