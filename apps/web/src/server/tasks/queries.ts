import { prisma } from "@/lib/prisma";
import type { TaskDetails } from "@/components/task-dialog";

// Общий select задачи для карточек/списков (§9: работа, зависимости, файлы).
export const taskDetailsInclude = {
  project: { select: { id: true, number: true, title: true } },
  product: { select: { id: true, number: true, title: true } },
  assignee: { select: { id: true, name: true } },
  work: { select: { id: true, title: true, total: true, priceSnapshot: true } },
  files: { select: { id: true, fileName: true, hasThumb: true, mimeType: true } },
  dependencies: {
    include: {
      dependsOn: { select: { id: true, title: true, status: true } },
    },
  },
} as const;

type TaskWithIncludes = {
  id: string;
  title: string;
  type: string | null;
  status: "DRAFT" | "NEW" | "IN_PROGRESS" | "DONE";
  dueAt: Date | null;
  assigneeId: string | null;
  requiresPhoto: boolean;
  estimateMinutes: number | null;
  workId: string | null;
  quantity: unknown;
  createdAt: Date;
  doneAt: Date | null;
  doneById: string | null;
  createdById: string | null;
  project: { id: string; number: string; title: string };
  product: { id: string; number: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  work: { id: string; title: string; total: unknown; priceSnapshot: unknown } | null;
  files: { id: string; fileName: string; hasThumb: boolean; mimeType: string }[];
  dependencies: {
    dependsOn: { id: string; title: string; status: "DRAFT" | "NEW" | "IN_PROGRESS" | "DONE" };
  }[];
};

// Маппинг в TaskDetails: подтягивает фактическое время (сумма TimeEntry)
// пачкой и имена автора/исполнителя закрытия.
export async function mapTaskDetails(
  tasks: TaskWithIncludes[],
): Promise<TaskDetails[]> {
  const taskIds = tasks.map((task) => task.id);
  const spent = taskIds.length
    ? await prisma.timeEntry.groupBy({
        by: ["taskId"],
        where: { taskId: { in: taskIds }, stoppedAt: { not: null } },
        _sum: { minutes: true },
      })
    : [];
  const spentMap = new Map(spent.map((row) => [row.taskId, row._sum.minutes ?? 0]));

  const userIds = [
    ...new Set(
      tasks
        .flatMap((task) => [task.createdById, task.doneById])
        .filter((v): v is string => !!v),
    ),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userNames = new Map(users.map((user) => [user.id, user.name]));

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    type: task.type,
    status: task.status,
    dueAt: task.dueAt?.toISOString() ?? null,
    assigneeId: task.assigneeId,
    assigneeName: task.assignee?.name ?? null,
    requiresPhoto: task.requiresPhoto,
    estimateMinutes: task.estimateMinutes,
    spentMinutes: spentMap.get(task.id) ?? 0,
    workId: task.workId,
    workTitle: task.work?.title ?? null,
    workTotal: task.work ? String(task.work.total) : null,
    workPriceSnapshot: task.work ? String(task.work.priceSnapshot) : null,
    quantity: task.quantity ? String(task.quantity) : null,
    dependencies: task.dependencies.map((edge) => ({
      id: edge.dependsOn.id,
      title: edge.dependsOn.title,
      status: edge.dependsOn.status,
    })),
    projectId: task.project.id,
    projectNumber: task.project.number,
    projectTitle: task.project.title,
    productId: task.product?.id ?? null,
    productNumber: task.product?.number ?? null,
    productTitle: task.product?.title ?? null,
    files: task.files,
    createdAt: task.createdAt.toISOString(),
    doneAt: task.doneAt?.toISOString() ?? null,
    doneByName: task.doneById ? (userNames.get(task.doneById) ?? null) : null,
    createdByName: task.createdById
      ? (userNames.get(task.createdById) ?? null)
      : null,
  }));
}
