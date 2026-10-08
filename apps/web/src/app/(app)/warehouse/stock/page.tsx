import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES } from "@/lib/roles";
import { WAREHOUSE_MANAGE_ROLES, WAREHOUSE_MONEY_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { listMaterialOptions, listStock } from "@/server/warehouse/queries";

import { StockView } from "./stock-view";

export const dynamic = "force-dynamic";

// «Склад → Остатки» (§12): остатки из движений, нехватка по открытым
// потребностям проектов. Цены видят только админ/директор (showMoney),
// приход вносят админ/директор/менеджер (canManage).
export default async function WarehouseStockPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;
  if (!hasAnyRole(role, OFFICE_ROLES)) {
    redirect("/");
  }

  const [rows, materials] = await Promise.all([
    listStock(session.user),
    listMaterialOptions(session.user),
  ]);

  const purchaseOptions = hasAnyRole(role, FINANCE_ROLES) ? {
    cashAccounts: await prisma.cashAccount.findMany({ where: { active: true }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }),
    expenseArticles: await prisma.expenseArticle.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } }),
  } : undefined;
  return (
    <StockView
      rows={rows}
      purchaseOptions={purchaseOptions}
      materials={materials}
      canManage={hasAnyRole(role, WAREHOUSE_MANAGE_ROLES)}
      showMoney={hasAnyRole(role, WAREHOUSE_MONEY_ROLES)}
    />
  );
}
