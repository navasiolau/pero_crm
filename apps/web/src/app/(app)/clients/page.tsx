import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { listClientDirectory } from "@/server/clients/queries";

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
  if (!hasAnyRole(session.user.roles, OFFICE_ROLES)) {
    redirect("/");
  }

  const { focus } = await searchParams;
  const clients = await listClientDirectory(session.user);

  return (
    <ClientsView
      canManage={hasAnyRole(session.user.roles, MANAGER_ROLES)}
      focusClientId={focus}
      clients={clients}
    />
  );
}
