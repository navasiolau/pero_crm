import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserPreference } from "@/server/preferences";
import { getActiveTimer } from "@/server/time/actions";
import { mapTaskDetails, taskDetailsIncludeFor, taskWorkspaceWhere } from "@/server/tasks/queries";
import { resolveVisibilityActor } from "@/server/access/visibility";

import { MyTasksView } from "./my-tasks-view";

export const dynamic = "force-dynamic";

// «Мои задачи» — главный экран работника/монтажника (§4, §15):
// увидел → «В работу» (таймер сам стартует) → выполнил (таймер сам стоп) → фото.
export default async function MyTasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveVisibilityActor(prisma, session.user);

  const [tasks, activeTimer, view] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [{ assigneeId: session.user.id }, await taskWorkspaceWhere(actor)] },
      include: taskDetailsIncludeFor(actor),
      orderBy: [
        { status: "asc" },
        { dueAt: "asc" },
        { createdAt: "desc" },
      ],
      take: 100,
    }),
    getActiveTimer(),
    getUserPreference(session.user.id, "my.view"),
  ]);

  const mapped = await mapTaskDetails(tasks, actor);
  const active = mapped.filter((task) => task.status !== "DONE");
  const done = mapped.filter((task) => task.status === "DONE").slice(0, 10);

  return (
    <MyTasksView
      actorUserId={session.user.id}
      active={active}
      done={done}
      userName={session.user.name ?? ""}
      role={session.user.roles}
      initialView={view === "kanban" ? "kanban" : "list"}
      timer={
        activeTimer
          ? {
              taskId: activeTimer.taskId,
              taskTitle: activeTimer.task.title,
              projectNumber: activeTimer.task.project.number,
              startedAt: activeTimer.startedAt.toISOString(),
            }
          : null
      }
    />
  );
}
