import { prisma } from "@/lib/prisma";
import { requireFinance } from "@/server/require-role";
import { loadOrganizationPayments } from "@/server/finance/organization-ledger";
import { OrganizationPaymentsView } from "@/components/organization-payments-view";

export const dynamic = "force-dynamic";
export default async function OrganizationExpensesPage() {
  const session = await requireFinance();
  const [data, articles] = await Promise.all([loadOrganizationPayments(session.user, "EXPENSE", prisma),
    prisma.expenseArticle.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } })]);
  return <OrganizationPaymentsView direction="EXPENSE" {...data} expenseArticles={articles} />;
}
