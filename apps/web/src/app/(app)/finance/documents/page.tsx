import { requireFinance } from "@/server/require-role";
import { financeDocuments } from "@/server/finance-documents/service";
import { financeDocumentListSchema } from "@/server/finance-documents/contracts";
import { FinanceDocumentsView } from "./documents-view";

export const dynamic = "force-dynamic";
export default async function FinanceDocumentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireFinance(), values = await searchParams;
  const parsed = financeDocumentListSchema.safeParse({ page: values.page, pageSize: values.pageSize,
    query: values.q, sort: values.sort, direction: values.dir });
  const result = await financeDocuments.list(session.user.id, parsed.success ? parsed.data : {});
  return <FinanceDocumentsView {...result} />;
}
