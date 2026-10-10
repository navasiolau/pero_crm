import { logisticsWebActorId } from "./web-actor";
import { logisticsTransaction } from "./service";
import { getLogisticsTripMoneyCore, getLogisticsMoneyOptionsCore, getLogisticsProjectBudgetCore } from "./money-query-core";

export async function getLogisticsTripMoney(tripId: string) {
  const actorId = await logisticsWebActorId("manage");
  return logisticsTransaction(tx => getLogisticsTripMoneyCore(actorId, tripId, tx));
}
export async function getLogisticsMoneyOptions() {
  const actorId = await logisticsWebActorId("manage");
  return logisticsTransaction(tx => getLogisticsMoneyOptionsCore(actorId, tx));
}
export async function getLogisticsProjectBudget(projectId: string) {
  const actorId = await logisticsWebActorId("manage");
  return logisticsTransaction(tx => getLogisticsProjectBudgetCore(actorId, projectId, tx));
}
