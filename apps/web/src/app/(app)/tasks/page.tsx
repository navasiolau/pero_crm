import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserPreference } from "@/server/preferences";
import { listWorkers } from "@/server/projects/queries";
import { mapTaskDetails, taskDetailsInclude } from "@/server/tasks/queries";

import { TasksPageView } from "./tasks-page-view";

export const dynamic = "force-dynamic";

// Раздел «Задачи» — все задачи организации (офисные роли, §4).
export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (!["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"].includes(role)) {
    redirect("/my");
  }

  const [tasks, workers, view] = await Promise.all([
    prisma.task.findMany({
      include: taskDetailsInclude,
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
      canEdit={["ADMIN", "DIRECTOR", "MANAGER"].includes(role)}
      initialView={view === "table" ? "table" : "kanban"}
      workers={workers.map((worker) => ({
        id: worker.id,
        name: worker.name,
        hint: worker.position ?? undefined,
      }))}
    />
  );
}
