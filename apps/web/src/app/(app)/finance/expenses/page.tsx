import { prisma } from "@/lib/prisma";
import { listStockReceiptMaterials } from "@/server/warehouse/stock-purchase-queries";
import { requireFinance } from "@/server/require-role";
import { loadOrganizationPayments } from "@/server/finance/organization-ledger";
import { OrganizationPaymentsView } from "@/components/organization-payments-view";
import { loadMaterialCreateOptions } from "@/server/warehouse/material-create-options";

export const dynamic = "force-dynamic";
export default async function OrganizationExpensesPage() {
  const session = await requireFinance();
  const [data, articles, stockMaterials, materialCreateOptions] = await Promise.all([loadOrganizationPayments(session.user, "EXPENSE", prisma),
    prisma.expenseArticle.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } }), listStockReceiptMaterials(session.user, prisma), loadMaterialCreateOptions(session.user)]);
  return <OrganizationPaymentsView direction="EXPENSE" {...data} expenseArticles={articles} stockMaterials={stockMaterials} materialCreateOptions={materialCreateOptions} />;
}
