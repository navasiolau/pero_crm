import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { prisma } from "@/lib/prisma";

import { MyTasksView } from "./my-tasks-view";

export const dynamic = "force-dynamic";

// «Мои задачи» — главный экран работника/монтажника (§4, §15).
// Таймер и оценка времени — фаза 3 (§9).
export default async function MyTasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const tasks = await prisma.task.findMany({
    where: { assigneeId: session.user.id },
    include: {
      project: {
        select: {
          id: true,
          number: true,
          title: true,
          client: { select: { name: true, lastName: true, middleName: true } },
        },
      },
      _count: { select: { files: true } },
    },
    orderBy: [
      { status: "asc" }, // NEW/IN_PROGRESS выше DONE (алфавит enum-порядок подходит кроме DRAFT)
      { dueAt: "asc" },
      { createdAt: "desc" },
    ],
    take: 100,
  });

  const active = tasks.filter((task) => task.status !== "DONE");
  const done = tasks.filter((task) => task.status === "DONE").slice(0, 10);

  const mapTask = (task: (typeof tasks)[number]) => ({
    id: task.id,
    title: task.title,
    type: task.type,
    status: task.status,
    dueAt: task.dueAt?.toISOString() ?? null,
    requiresPhoto: task.requiresPhoto,
    filesCount: task._count.files,
    projectId: task.project.id,
    projectNumber: task.project.number,
    projectTitle: task.project.title,
    clientName: displayClientName(task.project.client),
  });

  return (
    <MyTasksView
      active={active.map(mapTask)}
      done={done.map(mapTask)}
      userName={session.user.name ?? ""}
    />
  );
}
