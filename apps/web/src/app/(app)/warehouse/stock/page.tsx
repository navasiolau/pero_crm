import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
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

  return (
    <StockView
      rows={rows}
      materials={materials}
      canManage={hasAnyRole(role, MANAGER_ROLES)}
      showMoney={hasAnyRole(role, ["ADMIN", "DIRECTOR"])}
    />
  );
}
