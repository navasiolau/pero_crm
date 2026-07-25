import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { PricesView } from "./prices-view";

export const dynamic = "force-dynamic";

// Прайсы (§9): управление — админ/директор/менеджер, просмотр — инженер (§4).
export default async function PricesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(role)) {
    redirect("/");
  }

  const items = await prisma.priceItem.findMany({
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  return (
    <PricesView
      canManage={["ADMIN", "DIRECTOR", "MANAGER"].includes(role)}
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
