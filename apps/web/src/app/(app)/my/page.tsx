import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserPreference } from "@/server/preferences";
import { mapTaskDetails, taskDetailsIncludeFor, taskWorkspaceWhere } from "@/server/tasks/queries";
import { resolveVisibilityActor } from "@/server/access/visibility";

import { MyTasksView } from "./my-tasks-view";

export const dynamic = "force-dynamic";

// «Мои задачи» — главный экран работника/монтажника (§4, §15):
// увидел → «Взять в работу» → приложил фото → «Завершить».
export default async function MyTasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveVisibilityActor(prisma, session.user);

  const [tasks, view] = await Promise.all([
    prisma.task.findMany({
      where: await taskWorkspaceWhere(actor,{tasks:{assigneeId:session.user.id}}),
      include: taskDetailsIncludeFor(actor),
      orderBy: [
        { status: "asc" },
        { dueAt: "asc" },
        { createdAt: "desc" },
      ],
      take: 100,
    }),
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
      initialView={view === "kanban" ? "kanban" : "list"}
    />
  );
}
