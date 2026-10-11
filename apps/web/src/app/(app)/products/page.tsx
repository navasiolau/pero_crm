import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import {canViewProductMoney} from "@/lib/product-financial-access";
import { ListParamsProvider } from "@/lib/list-params";
import { listPreferences } from "@/server/list-preferences";
import { listEngineers } from "@/server/projects/queries";
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

  const rawParams = await searchParams;
  const state = await listPreferences.load("products", rawParams);
  if (Object.keys(rawParams).length === 0) redirect(`/products?${state.query}`);
  const params = Object.fromEntries(new URLSearchParams(state.query));
  const { filters, page, pageSize } = parseProductListParams(params);
  const view = params.view === "table" ? "table" : "kanban";

  const [result, options, engineers] = await Promise.all([
    listProducts(
      session.user.id,
      role,
      view === "kanban" ? { ...filters, searchScope: "identity" } : filters,
      view === "table" ? { page, pageSize } : undefined,
    ),
    listProductFilterOptions(session.user.id, role),
    listEngineers(),
  ]);

  return (
    <ListParamsProvider key={session.user.id} section="products" initialQuery={state.query} preference={state.value}>
    <ProductsView
      view={view}
      resolvedQuery={state.query}
      products={result.rows.map((product) => ({
        id: product.id,
        number: product.number,
        title: product.title,
        kind: product.kind,
        status: product.status,
        statusChangedAt: product.statusChangedAt.toISOString(),
        expectedPrice: product.expectedPrice?.toString() ?? null,
        quantity: product.quantity,
        currency: product.project.currency,
        projectId: product.project.id,
        projectStage: product.project.stage,
        projectNumber: product.project.number,
        projectTitle: product.project.title,
        clientId: product.project.client.id,
        clientName: displayClientName(product.project.client),
        engineerName: product.engineer?.name ?? null,
        engineerId: product.engineerId,
        isEngineeringParticipant: product.isEngineeringParticipant,
        hasB3d: product.hasB3d,
        noModel: product.noModel,
        sketchFile: product.sketchFile,
      }))}
      total={result.total}
      page={page}
      pageSize={pageSize}
      canManage={hasAnyRole(role, MANAGER_ROLES)}
      actorRoles={role}
      actorUserId={session.user.id}
      showAmount={canViewProductMoney(role)}
      hideEngineerFilter={role.includes("ENGINEER") && !hasAnyRole(role, MANAGER_ROLES)}
      engineerOptions={engineers.map((engineer) => ({
        value: engineer.id,
        label: engineer.name,
      }))}
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
    </ListParamsProvider>
  );
}
