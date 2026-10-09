import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasAnyRole, WAREHOUSE_UNIT_ADMIN_ROLES } from "@/lib/roles";
import { listMaterialUnits } from "@/server/warehouse/unit-queries";
import { MaterialUnitsView } from "./units-view";

export const dynamic = "force-dynamic";
export default async function WarehouseUnitsSettingsPage() {
  const session = await auth();
  if (!session?.user || !hasAnyRole(session.user.roles, WAREHOUSE_UNIT_ADMIN_ROLES)) redirect("/");
  return <MaterialUnitsView rows={await listMaterialUnits(session.user)} />;
}
