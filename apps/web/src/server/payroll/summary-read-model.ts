import { Prisma } from "@prisma/client";
import { historicalByn } from "@/lib/history-byn";

type HistoricalMoney = Parameters<typeof historicalByn>[0];
export type PayrollHistoryRow = HistoricalMoney & { userId: string; month: string; scheme: string };
export type PayoutHistoryRow = HistoricalMoney & { userId: string; month: string; kind: string };
type DecimalGroups = Map<string, Prisma.Decimal | null>;
export type PayrollAmounts = ReadonlyMap<string, number | null>;

function add(sum: Prisma.Decimal | null, row: HistoricalMoney): Prisma.Decimal | null {
  if (sum === null) return null;
  const amount = historicalByn(row);
  return amount === null ? null : sum.plus(amount);
}
function addUser(group: DecimalGroups, userId: string, row: HistoricalMoney) {
  group.set(userId, add(group.has(userId) ? group.get(userId)! : new Prisma.Decimal(0), row));
}
function rounded(sum: Prisma.Decimal | null): number | null {
  return sum?.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber() ?? null;
}
function amounts(group: DecimalGroups): PayrollAmounts {
  return new Map([...group].map(([userId, sum]) => [userId, rounded(sum)]));
}
export function groupHistoricalByn<Row extends HistoricalMoney & { userId: string }>(rows: readonly Row[]) {
  const groups: DecimalGroups = new Map();
  for (const row of rows) addUser(groups, row.userId, row);
  return amounts(groups);
}
export function payrollAmount(group: PayrollAmounts, userId: string): number | null {
  return group.has(userId) ? group.get(userId)! : 0;
}

export type PayrollReadModel = {
  selectedMonth: string;
  currentPeriod: string;
  userScope: string | null;
  accrued: PayrollAmounts;
  paid: PayrollAmounts;
  advances: PayrollAmounts;
  pastAccrued: PayrollAmounts;
  estimates: PayrollAmounts;
  turnoverAccrued: PayrollAmounts;
  totalPaid: PayrollAmounts;
  allPaid: number | null;
};

// Снимок живёт только внутри текущего чтения/preview. Общая сумма выплат
// всегда включает всех сотрудников, даже при payroll scope одного должника.
export function summarizePayrollHistory(entries: readonly PayrollHistoryRow[], payouts: readonly PayoutHistoryRow[],
  selectedMonth: string, currentPeriod: string, userScope: string | null = null): PayrollReadModel {
  const accrued: DecimalGroups = new Map(), paid: DecimalGroups = new Map(), advances: DecimalGroups = new Map();
  const pastAccrued: DecimalGroups = new Map(), estimates: DecimalGroups = new Map(), turnoverAccrued: DecimalGroups = new Map();
  const totalPaid: DecimalGroups = new Map();
  let allPaid: Prisma.Decimal | null = new Prisma.Decimal(0);
  for (const row of entries) {
    const userId = row.userId;
    if (userScope !== null && userId !== userScope) continue;
    if (row.month === selectedMonth) {
      addUser(accrued, userId, row);
      if (row.scheme === "PERCENT_TURNOVER") addUser(turnoverAccrued, userId, row);
    }
    if (row.month < currentPeriod) addUser(pastAccrued, userId, row);
    if (row.month === currentPeriod) addUser(estimates, userId, row);
  }
  for (const row of payouts) {
    allPaid = add(allPaid, row);
    const userId = row.userId;
    if (userScope !== null && userId !== userScope) continue;
    addUser(totalPaid, userId, row);
    if (row.month === selectedMonth) {
      addUser(paid, userId, row);
      if (row.kind === "ADVANCE") addUser(advances, userId, row);
    }
  }
  return { selectedMonth, currentPeriod, userScope, accrued: amounts(accrued), paid: amounts(paid), advances: amounts(advances),
    pastAccrued: amounts(pastAccrued), estimates: amounts(estimates), turnoverAccrued: amounts(turnoverAccrued),
    totalPaid: amounts(totalPaid), allPaid: rounded(allPaid) };
}

export function requirePayrollReadScope(model: PayrollReadModel, selectedMonth?: string, userScope: string | null = null, currentPeriod?: string) {
  if (model.userScope !== userScope || selectedMonth !== undefined && model.selectedMonth !== selectedMonth
    || currentPeriod !== undefined && model.currentPeriod !== currentPeriod) {
    throw new Error("Снимок зарплаты относится к другому периоду или сотруднику");
  }
}
