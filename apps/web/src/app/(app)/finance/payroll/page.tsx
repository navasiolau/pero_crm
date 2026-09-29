import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import {
  currentMonth,
  getCurrentMonthEstimates,
  getEmployeeDues,
  getMonthTurnover,
  getOrgBalance,
  getPayrollCurrency,
  getPayrollSummary,
  getTurnoverAccruals,
  isValidMonth,
  listPayrollUsers,
} from "@/server/payroll/queries";
import { listAdvanceOptions } from "@/server/payroll/cash-actions";

import { FinancePayrollView } from "./finance-payroll-view";

export const dynamic = "force-dynamic";

// «Финансы → Зарплата» (§10, админ/директор): сводка по сотрудникам
// за месяц, начисление «% от оборота», выплаты, экспорт CSV.
export default async function FinancePayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasAnyRole(session.user.roles, FINANCE_ROLES)) redirect("/");

  const { month: param } = await searchParams;
  const month = isValidMonth(param) ? param : currentMonth();

  const [summary, currency, turnover, turnoverAccruals, users, orgBalance, dues, estimates, cashOptions] =
    await Promise.all([
      getPayrollSummary(month),
      getPayrollCurrency(),
      getMonthTurnover(month),
      getTurnoverAccruals(month),
      listPayrollUsers(),
      getOrgBalance(),
      getEmployeeDues(),
      getCurrentMonthEstimates(),
      listAdvanceOptions(),
    ]);

  return (
    <FinancePayrollView
      month={month}
      currency={currency}
      rows={summary.rows}
      totals={summary.totals}
      payouts={summary.payouts}
      turnover={turnover}
      turnoverAccruals={turnoverAccruals}
      users={users}
      orgBalance={orgBalance}
      dues={dues}
      estimates={estimates}
      cashAccounts={cashOptions.accounts}
      advanceUsers={cashOptions.users}
    />
  );
}
