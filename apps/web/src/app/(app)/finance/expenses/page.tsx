import { prisma } from "@/lib/prisma";
import { ListParamsProvider } from "@/lib/list-params";
import type { ListSearchParams } from "@/lib/list-state";
import { OrganizationExpenseResults } from "@/components/organization-expense-results";
import { listStockReceiptMaterials } from "@/server/warehouse/stock-purchase-queries";
import { requireFinance } from "@/server/require-role";
import { loadOrganizationExpensePage } from "@/server/finance/organization-ledger";
import { listPreferences } from "@/server/list-preferences";
import { loadMaterialCreateOptions } from "@/server/warehouse/material-create-options";

export const dynamic = "force-dynamic";
export default async function OrganizationExpensesPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  const session = await requireFinance();
  const state = await listPreferences.load("organizationExpenses", await searchParams);
  const [data, articles, stockMaterials, materialCreateOptions] = await Promise.all([
    loadOrganizationExpensePage(session.user, state.query, prisma),
    prisma.expenseArticle.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } }),
    listStockReceiptMaterials(session.user, prisma),
    loadMaterialCreateOptions(session.user),
  ]);
  return <ListParamsProvider section="organizationExpenses" initialQuery={state.query} preference={state.value}>
    <OrganizationExpenseResults {...data} expenseArticles={articles} stockMaterials={stockMaterials} materialCreateOptions={materialCreateOptions}/>
  </ListParamsProvider>;
}
