import { FinanceNavigation } from "@/components/finance-navigation";
import { PAYROLL_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { requireFinance } from "@/server/require-role";

export default async function FinancePage() {
  const session = await requireFinance();
  return (
    <FinanceNavigation
      telegram={"telegramFinance" in session}
      showPayroll={hasAnyRole(session.user.roles, PAYROLL_MANAGE_ROLES)}
    />
  );
}
