import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";

import { PayrollSettingsForm } from "./payroll-settings-form";

export const dynamic = "force-dynamic";

// Настройки зарплаты (§10): единая валюта начислений и расчётников.
// Доступ — администратор и директор (как весь раздел «Настройки»).
export default async function PayrollSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasAnyRole(session.user.roles, ADMIN_ROLES)) redirect("/");

  return <PayrollSettingsForm />;
}
