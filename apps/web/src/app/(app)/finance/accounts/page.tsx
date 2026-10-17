import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import { listCashAccounts } from "@/server/finance/queries";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CASH_ACCOUNT_MANAGE_ROLES } from "@/lib/cash-account-default";
import { readDefaultCashAccount } from "@/server/finance/default-cash-core";

import { AccountsView } from "./accounts-view";

export const dynamic = "force-dynamic";

// «Финансы → Кассы» (§11, админ/директор): кассы в своих валютах,
// остатки = приходы − расходы по операциям кассы.
export default async function FinanceAccountsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasAnyRole(session.user.roles, FINANCE_ROLES)) redirect("/");

  const [accounts, defaultCashAccount] = await Promise.all([listCashAccounts(), readDefaultCashAccount(prisma)]);
  return <AccountsView accounts={accounts} defaultCashAccount={defaultCashAccount} canManageDefault={hasAnyRole(session.user.roles, DEFAULT_CASH_ACCOUNT_MANAGE_ROLES)} />;
}
