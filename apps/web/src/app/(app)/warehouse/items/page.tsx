import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listCategories, listMaterials } from "@/server/warehouse/queries";

import { ItemsView } from "./items-view";

export const dynamic = "force-dynamic";

// «Склад → Номенклатура» (§12): справочник материалов и категорий.
// Управление — админ/директор/менеджер, цены видят админ/директор.
export default async function WarehouseItemsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(role)) {
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
      canManage={["ADMIN", "DIRECTOR", "MANAGER"].includes(role)}
      showMoney={["ADMIN", "DIRECTOR"].includes(role)}
    />
  );
}
