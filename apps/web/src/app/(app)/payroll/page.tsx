import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { hasRole } from "@/lib/roles";
import {
  currentMonth,
  getMyPayroll,
  getPayrollCurrency,
  isValidMonth,
} from "@/server/payroll/queries";

import { PayrollView } from "./payroll-view";

export const dynamic = "force-dynamic";

// «Моя зарплата» (§10): расчётник real-time — начислено за месяц
// + детализация − выплаченное. Директору зарплата не считается (§4).
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (hasRole(session.user.roles, "DIRECTOR")) redirect("/");

  const { month: param } = await searchParams;
  const month = isValidMonth(param) ? param : currentMonth();

  const [data, currency] = await Promise.all([
    getMyPayroll(session.user.id, month),
    getPayrollCurrency(),
  ]);

  return <PayrollView month={month} currency={currency} {...data} />;
}
