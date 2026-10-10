import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canReadPrices, canManagePrices } from "@/lib/roles";

import { PricesView } from "./prices-view";

export const dynamic = "force-dynamic";

// Прайсы (§9): прежние офисные grants и узкое дополнение ответственного.
export default async function PricesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;
  if (!canReadPrices(role)) {
    redirect("/");
  }

  const items = await prisma.priceItem.findMany({
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  return (
    <PricesView
      canManage={canManagePrices(role)}
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
