import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getPayrollCurrency } from "@/server/payroll/queries";

import { PayrollSettingsForm } from "./payroll-settings-form";

export const dynamic = "force-dynamic";

// Настройки зарплаты (§10): единая валюта начислений и расчётников.
// Доступ — администратор и директор (как весь раздел «Настройки»).
export default async function PayrollSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["ADMIN", "DIRECTOR"].includes(session.user.role)) redirect("/");

  const currency = await getPayrollCurrency();
  return <PayrollSettingsForm currency={currency} />;
}
