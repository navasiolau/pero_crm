import type { LogisticsTripDocumentsView, LogisticsTripListInput, LogisticsTripView } from "@/server/logistics/contracts";
import type { getLogisticsOptions } from "@/server/logistics/queries";
import type { getLogisticsMoneyOptions, getLogisticsProjectBudget, getLogisticsTripMoney } from "@/server/logistics/money-queries";

export type TripOptions = Awaited<ReturnType<typeof getLogisticsOptions>>;
export type TripMoney = Awaited<ReturnType<typeof getLogisticsTripMoney>>;
export type MoneyOptions = Awaited<ReturnType<typeof getLogisticsMoneyOptions>>;
export type ProjectBudget = Awaited<ReturnType<typeof getLogisticsProjectBudget>>;
export type ManagedTrip = LogisticsTripView & { money: TripMoney };
export type TripRow = ManagedTrip | LogisticsTripDocumentsView;
type ListData = { query: LogisticsTripListInput; total: number; projectId?: string };
export type LogisticsWorkspaceData =
  | (ListData & { mode: "manage"; rows: ManagedTrip[]; options: TripOptions; moneyOptions: MoneyOptions; budget: ProjectBudget | null; initialTrip: ManagedTrip | null })
  | (ListData & { mode: "documents"; rows: LogisticsTripDocumentsView[]; initialTrip: LogisticsTripDocumentsView | null });
