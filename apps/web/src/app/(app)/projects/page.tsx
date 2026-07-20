import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { getUserPreference } from "@/server/preferences";
import { listClients, listEngineers, listManagers, listProjects } from "@/server/projects/queries";

import { ProjectsView } from "./projects-view";

export const dynamic = "force-dynamic";

// Проекты: канбан по умолчанию, таблица — по переключателю (§7).
// Выбор вида сохраняется в UserPreference per user.
export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const [projects, view, clients, managers, engineers] = await Promise.all([
    listProjects(session.user.id, role),
    getUserPreference(session.user.id, "projects.view"),
    listClients(),
    listManagers(),
    listEngineers(),
  ]);
  const canManage = ["ADMIN", "DIRECTOR", "MANAGER"].includes(role);

  return (
    <ProjectsView
      projects={projects.map((project) => ({
        id: project.id,
        number: project.number,
        title: project.title,
        stage: project.stage,
        stageChangedAt: project.stageChangedAt.toISOString(),
        expectedPrice: project.expectedPrice?.toString() ?? null,
        currency: project.currency,
        clientName: displayClientName(project.client),
        managerName: project.manager?.name ?? null,
        tasksCount: project._count.tasks,
        filesCount: project._count.files,
        hasMaterialShortage: project.hasMaterialShortage,
      }))}
      initialView={view === "table" ? "table" : "kanban"}
      canManage={canManage}
      showAmount={["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"].includes(role)}
      clients={clients.map((client) => ({ id: client.id, name: client.name }))}
      managers={managers.map((manager) => ({ id: manager.id, name: manager.name }))}
      engineers={engineers.map((engineer) => ({ id: engineer.id, name: engineer.name }))}
    />
  );
}
