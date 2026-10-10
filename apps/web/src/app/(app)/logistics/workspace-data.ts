import { getLogisticsOptions, getLogisticsProjectTrips, getLogisticsTrip, listLogisticsTrips } from "@/server/logistics/queries";
import { getLogisticsMoneyOptions, getLogisticsProjectBudget, getLogisticsTripMoney } from "@/server/logistics/money-queries";
import type { LogisticsWorkspaceData, ManagedTrip } from "@/components/logistics/types";

export async function loadLogisticsWorkspace(input: unknown = {}, projectId?: string, tripId?: string): Promise<LogisticsWorkspaceData> {
  const list = projectId
    ? await getLogisticsProjectTrips(projectId, input as Record<string, unknown>)
    : await listLogisticsTrips(input);
  const selectedId = tripId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tripId) ? tripId : undefined;
  const selected = selectedId ? list.rows.find(row => row.id === selectedId) ?? await getLogisticsTrip(selectedId) : null;
  if (list.mode === "documents") {
    return { ...list, initialTrip: selected?.mode === "documents" ? selected : null };
  }
  const [options, moneyOptions, budget, money] = await Promise.all([
    getLogisticsOptions(), getLogisticsMoneyOptions(),
    projectId ? getLogisticsProjectBudget(projectId) : Promise.resolve(null),
    Promise.all(list.rows.map(async row => [row.id, await getLogisticsTripMoney(row.id)] as const)),
  ]);
  const moneyById = new Map(money);
  const rows = list.rows.map(row => ({ ...row, money: moneyById.get(row.id)! }));
  let initialTrip: ManagedTrip | null = null;
  if (selected?.mode === "manage" && (!projectId || selected.shares.some(share => share.projectId === projectId))) {
    initialTrip = rows.find(row => row.id === selected.id) ?? { ...selected, money: await getLogisticsTripMoney(selected.id) };
  }
  return { ...list, rows, options, moneyOptions, budget, projectId, initialTrip };
}
