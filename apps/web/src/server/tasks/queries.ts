import { prisma } from "@/lib/prisma";
import type { TaskDetails } from "@/components/task-dialog";
import type { ProductStatus } from "@prisma/client";
import { fileVisibilityWhere, taskVisibilityWhere, workVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";
import { FULL_SHARE_UNITS, personalQuantity, taskPieceAmount } from "@/lib/work-shares";
import { getPayrollCurrency } from "@/server/payroll/queries";
import { canSplitTask } from "./share-policy";

// Общий select задачи для карточек/списков (§9: работа, зависимости, файлы).
export const taskDetailsInclude = {
  project: { select: { id: true, number: true, title: true } },
  product: { select: { id: true, number: true, title: true, engineerId: true, status: true } },
  assignee: { select: { id: true, name: true } },
  work: { select: { id: true, title: true, total: true, priceSnapshot: true } },
  allocationGroup: { select: { currency: true } },
  _count: { select: { payrollEntries: true } },
  files: { select: { id: true, fileName: true, hasThumb: true, mimeType: true } },
  dependencies: {
    include: {
      dependsOn: { select: { id: true, title: true, status: true } },
    },
  },
} as const;

// All nested contexts must obey the same actor policy as the outer task.
export function taskDetailsIncludeFor(actor: VisibilityActor) {
  return {
    ...taskDetailsInclude,
    work: { ...taskDetailsInclude.work, where: workVisibilityWhere(actor) },
    files: { ...taskDetailsInclude.files, where: fileVisibilityWhere(actor) },
    dependencies: {
      ...taskDetailsInclude.dependencies,
      where: { dependsOn: taskVisibilityWhere(actor) },
    },
  } as const;
}

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
  executorShare?: unknown;
  allocationGroupId?: string | null;
  shareUnits?: number | null;
  shareAmount?: unknown;
  splitRevision?: number;
  allocationGroup?: { currency: string | null } | null;
  _count?: { payrollEntries: number };
  createdAt: Date;
  doneAt: Date | null;
  doneById: string | null;
  createdById: string | null;
  project: { id: string; number: string; title: string };
  product: { id: string; number: string; title: string; engineerId: string | null; status: ProductStatus } | null;
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
  actor?: VisibilityActor,
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
  const currency = tasks.some((task) => task.work && !task.allocationGroup) ? await getPayrollCurrency() : null;

  return tasks.map((task) => {
    const allocation = {
      quantity: task.work && task.quantity !== null && task.quantity !== undefined ? String(task.quantity) : null,
      executorShare: String(task.executorShare ?? 1), allocationGroupId: task.allocationGroupId ?? null,
      shareUnits: task.shareUnits ?? FULL_SHARE_UNITS, shareAmount: task.shareAmount === null || task.shareAmount === undefined ? null : String(task.shareAmount),
    };
    return ({
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
    workId: task.work?.id ?? null,
    workTitle: task.work?.title ?? null,
    workTotal: task.work ? String(task.work.total) : null,
    workPriceSnapshot: task.work ? String(task.work.priceSnapshot) : null,
    quantity: task.quantity ? String(task.quantity) : null,
    allocationGroupId: allocation.allocationGroupId,
    shareUnits: allocation.shareUnits,
    shareAmount: task.work ? taskPieceAmount(allocation, String(task.work.priceSnapshot)) : null,
    shareCurrency: task.work ? task.allocationGroup?.currency ?? currency : null,
    personalQuantity: personalQuantity(allocation),
    splitRevision: task.splitRevision ?? 0,
    canSplit: actor ? canSplitTask(actor, { ...task, paidCount: task._count?.payrollEntries ?? 0 }) : false,
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
  });
  });
}
