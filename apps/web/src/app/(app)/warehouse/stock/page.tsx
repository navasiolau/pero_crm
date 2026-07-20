import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listMaterialOptions, listStock } from "@/server/warehouse/queries";

import { StockView } from "./stock-view";

export const dynamic = "force-dynamic";

// «Склад → Остатки» (§12): остатки из движений, нехватка по открытым
// потребностям проектов. Цены видят только админ/директор (showMoney),
// приход вносят админ/директор/менеджер (canManage).
export default async function WarehouseStockPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"].includes(role)) {
    redirect("/");
  }

  const [rows, materials] = await Promise.all([
    listStock(),
    listMaterialOptions(),
  ]);

  return (
    <StockView
      rows={rows}
      materials={materials}
      canManage={["ADMIN", "DIRECTOR", "MANAGER"].includes(role)}
      showMoney={["ADMIN", "DIRECTOR"].includes(role)}
    />
  );
}
