import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { clientVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

import { ClientsView } from "./clients-view";

export const dynamic = "force-dynamic";

// Клиенты (§4): офисные роли (достаточно любой из ролей пользователя).
// ?focus=<id> — открыть карточку клиента (ссылки из изделий/проектов).
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveVisibilityActor(prisma, session.user);
  if (!hasAnyRole(session.user.roles, OFFICE_ROLES)) {
    redirect("/");
  }

  const { focus } = await searchParams;
  const clients = await prisma.client.findMany({
    where: clientVisibilityWhere(actor),
    include: {
      projects: {
        where: projectVisibilityWhere(actor),
        select: { id: true, number: true, title: true },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { projects: { where: projectVisibilityWhere(actor) } } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <ClientsView
      focusClientId={focus}
      clients={clients.map((client) => ({
        id: client.id,
        name: client.name,
        lastName: client.lastName,
        middleName: client.middleName,
        phone: client.phone,
        email: client.email,
        address: client.address,
        comment: client.comment,
        projects: client.projects,
        projectsCount: client._count.projects,
      }))}
    />
  );
}
