import { auth } from "@/auth";
import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import { getLogisticsOptionsCore, getLogisticsTripCore, listLogisticsTripsCore } from "./query-core";
import { logisticsTransaction } from "./service";

export async function listLogisticsTrips(input: unknown = {}) {
  const session = await scopedFinanceAuth();
  return listLogisticsTripsCore(session?.user.id, input, logisticsTransaction);
}
export async function getLogisticsTrip(id: string) {
  const session = await scopedFinanceAuth();
  return getLogisticsTripCore(session?.user.id, id, logisticsTransaction);
}
export async function getLogisticsProjectTrips(projectId: string, input: Record<string, unknown> = {}) {
  return listLogisticsTripsCore((await auth())?.user.id, { ...input, projectId }, logisticsTransaction, "manage");
}
export async function getLogisticsOptions() {
  return getLogisticsOptionsCore((await scopedFinanceAuth())?.user.id, logisticsTransaction);
}
