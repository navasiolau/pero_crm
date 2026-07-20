import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listExpenseArticles } from "@/server/finance/queries";

import { ArticlesView } from "./articles-view";

export const dynamic = "force-dynamic";

// «Финансы → Статьи расходов» (§8/§11, админ/директор): справочник
// статей для расходов по проектам (материалы, логистика, прочее).
export default async function FinanceArticlesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["ADMIN", "DIRECTOR"].includes(session.user.role)) redirect("/");

  const articles = await listExpenseArticles();
  return <ArticlesView articles={articles} />;
}
