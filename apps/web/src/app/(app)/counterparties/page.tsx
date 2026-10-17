import { COUNTERPARTY_ROLES } from "@/lib/roles";
import { requireRole } from "@/server/require-role";
import { listCounterparties } from "@/server/counterparties/queries";
import { CounterpartiesView } from "./counterparties-view";

export const dynamic = "force-dynamic";

export default async function CounterpartiesPage() {
  const session = await requireRole(COUNTERPARTY_ROLES);
  return <CounterpartiesView rows={await listCounterparties(session.user)} />;
}
