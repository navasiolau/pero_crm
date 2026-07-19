import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserPreference } from "@/server/preferences";
import { listWorkers } from "@/server/projects/queries";

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
      include: {
        project: {
          select: { id: true, number: true, title: true },
        },
        assignee: { select: { id: true, name: true } },
        files: { select: { id: true, fileName: true, hasThumb: true, mimeType: true } },
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 300,
    }),
    listWorkers(),
    getUserPreference(session.user.id, "tasks.view"),
  ]);

  const authorIds = [
    ...new Set(
      tasks.flatMap((task) =>
        [task.createdById, task.doneById].filter((v): v is string => !!v),
      ),
    ),
  ];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const authorNames = new Map(authors.map((user) => [user.id, user.name]));

  return (
    <TasksPageView
      tasks={tasks.map((task) => ({
        id: task.id,
        title: task.title,
        type: task.type,
        status: task.status,
        dueAt: task.dueAt?.toISOString() ?? null,
        assigneeId: task.assigneeId,
        assigneeName: task.assignee?.name ?? null,
        requiresPhoto: task.requiresPhoto,
        projectId: task.project.id,
        projectNumber: task.project.number,
        projectTitle: task.project.title,
        files: task.files,
        createdAt: task.createdAt.toISOString(),
        doneAt: task.doneAt?.toISOString() ?? null,
        doneByName: task.doneById ? (authorNames.get(task.doneById) ?? null) : null,
        createdByName: task.createdById
          ? (authorNames.get(task.createdById) ?? null)
          : null,
      }))}
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
