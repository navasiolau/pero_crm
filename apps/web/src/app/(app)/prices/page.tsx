import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";

import { PricesView } from "./prices-view";

export const dynamic = "force-dynamic";

// Прайсы (§9): управление — менеджмент, просмотр — офисные роли (§4).
export default async function PricesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;
  if (!hasAnyRole(role, OFFICE_ROLES)) {
    redirect("/");
  }

  const items = await prisma.priceItem.findMany({
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  return (
    <PricesView
      canManage={hasAnyRole(role, MANAGER_ROLES)}
      items={items.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        price: item.price.toString(),
        category: item.category,
        active: item.active,
      }))}
    />
  );
}
