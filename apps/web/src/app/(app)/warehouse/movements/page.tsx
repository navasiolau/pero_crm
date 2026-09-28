import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { listMaterialOptions, listMovements } from "@/server/warehouse/queries";

import { MovementsView } from "./movements-view";

export const dynamic = "force-dynamic";

// «Склад → Движения» (§12): журнал приходов, списаний и возвратов
// (последние 500 операций). Суммы видят только админ/директор (showMoney).
export default async function WarehouseMovementsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;
  if (!hasAnyRole(role, OFFICE_ROLES)) {
    redirect("/");
  }

  const [rows, materials] = await Promise.all([
    listMovements(session.user),
    listMaterialOptions(session.user),
  ]);

  return (
    <MovementsView
      rows={rows}
      materials={materials}
      showMoney={hasAnyRole(role, ["ADMIN", "DIRECTOR"])}
    />
  );
}
