import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { ClientsView } from "./clients-view";

export const dynamic = "force-dynamic";

// Клиенты (§4): админ/директор/менеджер/инженер/бухгалтер.
// ?focus=<id> — открыть карточку клиента (ссылки из изделий/проектов).
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(session.user.role)) {
    redirect("/");
  }

  const { focus } = await searchParams;
  const clients = await prisma.client.findMany({
    include: {
      projects: {
        select: { id: true, number: true, title: true },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { projects: true } },
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
