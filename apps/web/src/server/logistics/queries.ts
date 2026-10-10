import { auth } from "@/auth";
import { getLogisticsOptionsCore, getLogisticsTripCore, listLogisticsTripsCore } from "./query-core";
import { logisticsTransaction } from "./service";

export async function listLogisticsTrips(input: unknown = {}) {
  return listLogisticsTripsCore((await auth())?.user.id, input, logisticsTransaction);
}
export async function getLogisticsTrip(id: string) {
  return getLogisticsTripCore((await auth())?.user.id, id, logisticsTransaction);
}
export async function getLogisticsProjectTrips(projectId: string, input: Record<string, unknown> = {}) {
  return listLogisticsTripsCore((await auth())?.user.id, { ...input, projectId }, logisticsTransaction, "manage");
}
export async function getLogisticsOptions() {
  return getLogisticsOptionsCore((await auth())?.user.id, logisticsTransaction);
}
