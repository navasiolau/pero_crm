import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { WAREHOUSE_MANAGE_ROLES, WAREHOUSE_MONEY_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { listCategories, listMaterials } from "@/server/warehouse/queries";

import { ItemsView } from "./items-view";

export const dynamic = "force-dynamic";

// «Склад → Номенклатура» (§12): справочник материалов и категорий.
// Управление — админ/директор/менеджер, цены видят админ/директор.
export default async function WarehouseItemsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;
  if (!hasAnyRole(role, OFFICE_ROLES)) {
    redirect("/");
  }

  const [rows, categories] = await Promise.all([
    listMaterials(session.user),
    listCategories(),
  ]);

  return (
    <ItemsView
      rows={rows}
      categories={categories}
      canManage={hasAnyRole(role, WAREHOUSE_MANAGE_ROLES)}
      showMoney={hasAnyRole(role, WAREHOUSE_MONEY_ROLES)}
    />
  );
}
