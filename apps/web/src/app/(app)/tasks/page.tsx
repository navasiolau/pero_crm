import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { getUserPreference } from "@/server/preferences";
import { listWorkers } from "@/server/projects/queries";
import { mapTaskDetails, taskDetailsIncludeFor, taskWorkspaceWhere } from "@/server/tasks/queries";
import { resolveVisibilityActor } from "@/server/access/visibility";

import { TasksPageView } from "./tasks-page-view";

export const dynamic = "force-dynamic";

// Раздел «Задачи» — все задачи организации (офисные роли, §4).
export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveVisibilityActor(prisma, session.user);
  const role = session.user.roles;
  if (!hasAnyRole(role, OFFICE_ROLES)) {
    redirect("/my");
  }

  const [tasks, workers, view] = await Promise.all([
    prisma.task.findMany({
      where: await taskWorkspaceWhere(actor,{tasks:{}}),
      include: taskDetailsIncludeFor(actor),
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 300,
    }),
    listWorkers(),
    getUserPreference(session.user.id, "tasks.view"),
  ]);

  const mapped = await mapTaskDetails(tasks, actor);

  return (
    <TasksPageView
      actorUserId={session.user.id}
      tasks={mapped}
      canEdit={hasAnyRole(role, MANAGER_ROLES)}
      initialView={view === "table" ? "table" : "kanban"}
      workers={workers.map((worker) => ({
        id: worker.id,
        name: worker.name,
        hint: worker.position ?? undefined,
      }))}
    />
  );
}
