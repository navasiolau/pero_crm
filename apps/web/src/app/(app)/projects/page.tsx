import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { hasFullProjectVisibility } from "@/server/access/visibility";
import { ListParamsProvider } from "@/lib/list-params";
import { listPreferences } from "@/server/list-preferences";
import {
  listClientOptions,
  listEngineers,
  listManagers,
  listProjects,
  parseProjectListParams,
} from "@/server/projects/queries";

import { ProjectsView } from "./projects-view";

export const dynamic = "force-dynamic";

// Параметры URL полностью определяют список; голый маршрут восстанавливает UserPreference.
// Канбан получает все отфильтрованные проекты, таблица — одну страницу.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.roles;
  const rawParams = await searchParams;
  const state = await listPreferences.load("projects", rawParams);
  if (Object.keys(rawParams).length === 0) redirect(`/projects?${state.query}`);
  const params = Object.fromEntries(new URLSearchParams(state.query));
  const { filters, page, pageSize } = parseProjectListParams(params);
  const view = params.view === "table" ? "table" : "kanban";

  const [result, clients, managers, engineers] = await Promise.all([
    listProjects(
      session.user.id,
      role,
      filters,
      // Канбану нужна вся отфильтрованная доска, таблице — страница
      view === "table" ? { page, pageSize } : undefined,
    ),
    listClientOptions(session.user),
    listManagers(),
    listEngineers(),
  ]);
  const canManage = hasAnyRole(role, MANAGER_ROLES);

  return (
    <ListParamsProvider key={session.user.id} section="projects" initialQuery={state.query} preference={state.value}>
    <ProjectsView
      view={view}
      projects={result.rows.map((project) => ({
        id: project.id,
        number: project.number,
        title: project.title,
        stage: project.stage,
        stageChangedAt: project.stageChangedAt.toISOString(),
        totalPrice: hasFullProjectVisibility(session.user) && project.totalPrice > 0 ? String(project.totalPrice) : null,
        currency: project.currency,
        clientId: project.client.id,
        clientName: displayClientName(project.client),
        managerName: project.manager?.name ?? null,
        productsCount: project._count.products,
        tasksCount: project._count.tasks,
        filesCount: project._count.files,
        hasMaterialShortage: project.hasMaterialShortage,
      }))}
      total={result.total}
      page={page}
      pageSize={pageSize}
      canManage={canManage}
      showAmount={hasFullProjectVisibility(session.user)}
      clients={clients.map((client) => ({ id: client.id, name: displayClientName(client) }))}
      managers={managers.map((manager) => ({ id: manager.id, name: manager.name }))}
      engineers={engineers.map((engineer) => ({ id: engineer.id, name: engineer.name }))}
    />
    </ListParamsProvider>
  );
}
