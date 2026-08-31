import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { getUserPreference } from "@/server/preferences";
import {
  listClientOptions,
  listEngineers,
  listManagers,
  listProjects,
  parseProjectListParams,
} from "@/server/projects/queries";

import { ProjectsView } from "./projects-view";

export const dynamic = "force-dynamic";

// Проекты: серверные фильтры/сортировка/пагинация (состояние в URL),
// вид канбан/таблица — параметр ?view с фолбэком на UserPreference (§7).
// Канбан получает все отфильтрованные проекты, таблица — одну страницу.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const params = await searchParams;
  const { filters, page, pageSize } = parseProjectListParams(params);

  const viewParam = (Array.isArray(params.view) ? params.view[0] : params.view) ?? "";
  const savedView = await getUserPreference(session.user.id, "projects.view");
  const view =
    viewParam === "table" || viewParam === "kanban"
      ? viewParam
      : savedView === "table"
        ? "table"
        : "kanban";

  const [result, clients, managers, engineers] = await Promise.all([
    listProjects(
      session.user.id,
      role,
      filters,
      // Канбану нужна вся отфильтрованная доска, таблице — страница
      view === "table" ? { page, pageSize } : undefined,
    ),
    listClientOptions(),
    listManagers(),
    listEngineers(),
  ]);
  const canManage = ["ADMIN", "DIRECTOR", "MANAGER"].includes(role);

  return (
    <ProjectsView
      view={view}
      projects={result.rows.map((project) => ({
        id: project.id,
        number: project.number,
        title: project.title,
        stage: project.stage,
        stageChangedAt: project.stageChangedAt.toISOString(),
        totalPrice: project.totalPrice > 0 ? String(project.totalPrice) : null,
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
      showAmount={["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(role)}
      clients={clients.map((client) => ({ id: client.id, name: displayClientName(client) }))}
      managers={managers.map((manager) => ({ id: manager.id, name: manager.name }))}
      engineers={engineers.map((engineer) => ({ id: engineer.id, name: engineer.name }))}
    />
  );
}
