import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
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
    listMaterials(),
    listCategories(),
  ]);

  return (
    <ItemsView
      rows={rows}
      categories={categories}
      canManage={hasAnyRole(role, MANAGER_ROLES)}
      showMoney={hasAnyRole(role, ["ADMIN", "DIRECTOR"])}
    />
  );
}
