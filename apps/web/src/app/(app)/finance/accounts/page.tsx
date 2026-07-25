import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listCashAccounts } from "@/server/finance/queries";

import { AccountsView } from "./accounts-view";

export const dynamic = "force-dynamic";

// «Финансы → Кассы» (§11, админ/директор): кассы в своих валютах,
// остатки = приходы − расходы по операциям кассы.
export default async function FinanceAccountsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(session.user.role)) redirect("/");

  const accounts = await listCashAccounts();
  return <AccountsView accounts={accounts} />;
}
