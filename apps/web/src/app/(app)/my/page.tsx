import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getActiveTimer } from "@/server/time/actions";
import { mapTaskDetails, taskDetailsInclude } from "@/server/tasks/queries";

import { MyTasksView } from "./my-tasks-view";

export const dynamic = "force-dynamic";

// «Мои задачи» — главный экран работника/монтажника (§4, §15):
// увидел → таймер → стоп → выполнил → фото (§9).
export default async function MyTasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [tasks, activeTimer] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: session.user.id },
      include: taskDetailsInclude,
      orderBy: [
        { status: "asc" },
        { dueAt: "asc" },
        { createdAt: "desc" },
      ],
      take: 100,
    }),
    getActiveTimer(session.user.id),
  ]);

  const mapped = await mapTaskDetails(tasks);
  const active = mapped.filter((task) => task.status !== "DONE");
  const done = mapped.filter((task) => task.status === "DONE").slice(0, 10);

  return (
    <MyTasksView
      active={active}
      done={done}
      userName={session.user.name ?? ""}
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
