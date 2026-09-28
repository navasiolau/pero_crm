import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { getUserPreference } from "@/server/preferences";
import { listWorkers } from "@/server/projects/queries";
import { mapTaskDetails, taskDetailsIncludeFor } from "@/server/tasks/queries";
import { taskVisibilityWhere } from "@/server/access/visibility";

import { TasksPageView } from "./tasks-page-view";

export const dynamic = "force-dynamic";

// Раздел «Задачи» — все задачи организации (офисные роли, §4).
export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.roles;
  if (!hasAnyRole(role, OFFICE_ROLES)) {
    redirect("/my");
  }

  const [tasks, workers, view] = await Promise.all([
    prisma.task.findMany({
      where: taskVisibilityWhere(session.user),
      include: taskDetailsIncludeFor(session.user),
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 300,
    }),
    listWorkers(),
    getUserPreference(session.user.id, "tasks.view"),
  ]);

  const mapped = await mapTaskDetails(tasks);

  return (
    <TasksPageView
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
