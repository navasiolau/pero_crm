import { PageHeader } from "@/components/page-header";
import { Journal } from "@/components/journal/journal";
import { requireAdmin } from "@/server/require-role";
import type { JournalQueryInput } from "@/server/changelog/query-contract";

export const dynamic = "force-dynamic";

export default async function ChangelogPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const text = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const sort = text("sort"), direction = text("dir");
  const initialQuery: JournalQueryInput = {
    q: text("q") ?? text("actor"), actorId: text("actorId"), entity: text("entity"), from: text("from"), to: text("to"),
    page: text("page") ? Number(text("page")) : undefined,
    pageSize: text("pageSize") ? Number(text("pageSize")) : undefined,
    sort: sort === "actor" || sort === "entity" || sort === "action" ? sort : "time",
    dir: direction === "asc" ? "asc" : "desc",
  };
  return <div className="flex min-w-0 flex-col gap-6">
    <PageHeader
      title="Журнал изменений"
      description="История изменений и важных операций в CRM. Нажмите строку, чтобы открыть событие целиком."
    />
    <Journal initialQuery={initialQuery}/>
  </div>;
}
