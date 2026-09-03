import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { getUserPreference } from "@/server/preferences";
import {
  listProductFilterOptions,
  listProducts,
  parseProductListParams,
} from "@/server/products/queries";

import { ProductsView } from "./products-view";

export const dynamic = "force-dynamic";

// Изделия: канбан/таблица с серверными фильтрами (состояние в URL),
// те же принципы, что у проектов. Канбан — все отфильтрованные изделия,
// таблица — одна страница. dnd статусов — админ/директор/менеджер (§4).
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;

  const params = await searchParams;
  const { filters, page, pageSize } = parseProductListParams(params);

  const viewParam = (Array.isArray(params.view) ? params.view[0] : params.view) ?? "";
  const savedView = await getUserPreference(session.user.id, "products.view");
  const view =
    viewParam === "table" || viewParam === "kanban"
      ? viewParam
      : savedView === "table"
        ? "table"
        : "kanban";

  const [result, options] = await Promise.all([
    listProducts(
      session.user.id,
      role,
      filters,
      view === "table" ? { page, pageSize } : undefined,
    ),
    listProductFilterOptions(session.user.id, role),
  ]);

  return (
    <ProductsView
      view={view}
      products={result.rows.map((product) => ({
        id: product.id,
        number: product.number,
        title: product.title,
        kind: product.kind,
        status: product.status,
        statusChangedAt: product.statusChangedAt.toISOString(),
        expectedPrice: product.expectedPrice?.toString() ?? null,
        currency: product.project.currency,
        projectId: product.project.id,
        projectNumber: product.project.number,
        projectTitle: product.project.title,
        clientId: product.project.client.id,
        clientName: displayClientName(product.project.client),
      }))}
      total={result.total}
      page={page}
      pageSize={pageSize}
      canManage={hasAnyRole(role, MANAGER_ROLES)}
      showAmount={hasAnyRole(role, OFFICE_ROLES)}
      projectOptions={options.projects.map((project) => ({
        value: project.id,
        label: project.number,
        hint: project.title,
      }))}
      clientOptions={options.clients.map((client) => ({
        value: client.id,
        label: displayClientName(client),
      }))}
    />
  );
}
