import {ordinaryFileListView, type OrdinaryFileForList} from "@/server/files/list-view";
import {taskWorkspaceEligibility,taskReward,type TaskWorkspaceScope} from './workspace-contract';
import {maskTaskPaymentRead} from "@/server/access/production-read-projection";
import {canViewProductMoney} from "@/lib/product-financial-access";
import type {Prisma} from '@prisma/client';
export async function taskWorkspaceWhere(actor:VisibilityActor,scope:TaskWorkspaceScope):Promise<Prisma.TaskWhereInput>{
  const visibility=taskVisibilityWhere(actor);
  return{AND:[visibility,await taskWorkspaceEligibility(prisma,scope,visibility)]};
}
import { prisma } from "@/lib/prisma";
import type { TaskDetails } from "@/lib/task-details";
import type { ProductStatus } from "@prisma/client";
import { fileVisibilityWhere, taskVisibilityWhere, workVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";
import { FULL_SHARE_UNITS, personalQuantity, taskPieceAmount } from "@/lib/work-shares";
import { INTERNAL_CURRENCY } from "@/lib/internal-currency";
import { canSplitTask } from "./share-policy";
import { canTransferPiecework, ordinaryPieceworkBinding } from "@/lib/piecework-policy";
import { canReassignOrdinaryTask } from "./task-reassignment-policy";
import { getEngineeringTaskPreview } from "@/server/product-stage-pay/preview";

// Общий select задачи для карточек/списков (§9: работа, зависимости, файлы).
export const taskDetailsInclude = {
  project: { select: { id: true, number: true, title: true } },
  product: { select: { id: true, number: true, title: true, engineerId: true, status: true } },
  assignee: { select: { id: true, name: true } },
  work: { select: { id: true, projectId:true,productId:true,title: true, total: true, priceSnapshot: true, paymentKind: true,
    stagePayPoolId: true, poolWeightUnits: true, _count: { select: { paymentConversions: true, settlementShares: true } } } },
  allocationGroup: { select: { currency: true, budgetSource: true, workId: true } },
  _count: { select: { payrollEntries: true, stageSettlementShares: true } },
  files: { select: { id: true, fileName: true, mimeType: true, section: true, uploadedById: true, projectId: true, productId: true, taskId: true } },
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
  workId: string | null;
  quantity: unknown;
  executorShare?: unknown;
  allocationGroupId?: string | null;
  shareUnits?: number | null;
  shareAmount?: unknown;
  stageShareUnits?: number | null;
  physicalOnlyShare?: boolean;
  splitRevision?: number;
  allocationGroup?: { currency: string | null; budgetSource: string; workId?: string | null } | null;
  _count?: { payrollEntries: number; stageSettlementShares?: number };
  createdAt: Date;
  doneAt: Date | null;
  doneById: string | null;
  createdById: string | null;
  project: { id: string; number: string; title: string };
  product: { id: string; number: string; title: string; engineerId: string | null; status: ProductStatus } | null;
  assignee: { id: string; name: string } | null;
  work: { id: string; projectId?:string;productId?:string|null;title: string; total: unknown; priceSnapshot: unknown; paymentKind?: "LEGACY" | "ENGINEERING" | "INSTALLATION";
    stagePayPoolId?: string | null; poolWeightUnits?: number | null; _count?: { paymentConversions: number; settlementShares: number } } | null;
  files: OrdinaryFileForList[];
  dependencies: {
    dependsOn: { id: string; title: string; status: "DRAFT" | "NEW" | "IN_PROGRESS" | "DONE" };
  }[];
};

// Маппинг в TaskDetails с именами автора и исполнителя закрытия.
export async function mapTaskDetails(
  tasks: TaskWithIncludes[],
  actor?: VisibilityActor,
): Promise<TaskDetails[]> {
  if(actor)tasks=maskTaskPaymentRead(actor,tasks);
  tasks=tasks.filter(task=>!!task.work&&!!task.product&&task.work.projectId===task.project.id&&task.work.productId===task.product.id);
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
  const ungroupedSetting = tasks.some((task) => task.work?.paymentKind === "LEGACY" && !task.allocationGroup)
    ? (await prisma.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? INTERNAL_CURRENCY : null;
  const currency = ungroupedSetting === INTERNAL_CURRENCY ? INTERNAL_CURRENCY : null;
  const engineeringProductIds = [...new Set(tasks.filter((task) => task.work?.paymentKind === "ENGINEERING").flatMap((task) => task.product ? [task.product.id] : []))];
  const previews = new Map<string, Awaited<ReturnType<typeof getEngineeringTaskPreview>>>();
  const previewErrors = new Map<string, string>();
  await Promise.all(engineeringProductIds.map(async (productId) => {
    try { previews.set(productId, await getEngineeringTaskPreview(prisma, productId)); }
    catch { previewErrors.set(productId, "Предварительная сумма недоступна: проверьте курс или распределение фонда"); }
  }));

  const fileViews = new Map(await Promise.all(tasks.map(async task => [task.id, await ordinaryFileListView(prisma, actor, task.files)] as const)));

  return tasks.map((task) => {
    const engineering = task.work?.paymentKind === "ENGINEERING";
    const percentageWork = engineering || task.work?.paymentKind === "INSTALLATION";
    const canSeePayment=!actor||canViewProductMoney(actor.roles)||task.assigneeId===actor.id;
    const preview = canSeePayment&&engineering && task.product ? previews.get(task.product.id)?.get(task.id) : undefined;
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
    workId: task.work?.id ?? null,
    workTitle: task.work?.title ?? null,
    workTotal: percentageWork || task.work?.total === null || task.work?.total === undefined ? null : String(task.work.total),
    workPriceSnapshot: percentageWork || task.work?.priceSnapshot === null || task.work?.priceSnapshot === undefined ? null : String(task.work.priceSnapshot),
    quantity: task.quantity ? String(task.quantity) : null,
    allocationGroupId: allocation.allocationGroupId,
    shareUnits: allocation.shareUnits,
    shareAmount: percentageWork ? null : task.work && task.work.priceSnapshot !== null && task.work.priceSnapshot !== undefined ? taskPieceAmount(allocation, String(task.work.priceSnapshot)) : null,
    ...(percentageWork?{rewardAmount:preview?.settled?preview.amount:null,rewardCurrency:preview?.settled?preview.currency:null,rewardSource:preview?.settled&&preview.amount!==null?'FROZEN_TASK_SNAPSHOT' as const:'UNAVAILABLE' as const}:taskReward(allocation,task.work?.priceSnapshot==null?null:String(task.work.priceSnapshot),task.work?task.allocationGroup?task.allocationGroup.currency:currency:null)),
    shareCurrency: percentageWork ? null : task.work ? task.allocationGroup ? task.allocationGroup.currency : currency : null,
    paymentKind: task.work?.paymentKind ?? "LEGACY",
    physicalShareUnits: allocation.shareUnits,
    stageShareUnits: engineering ? task.stageShareUnits ?? null : null,
    previewAmount: preview?.amount ?? null,
    previewCurrency: preview?.currency ?? null,
    previewReason: engineering && !preview ? previewErrors.get(task.product?.id ?? "") ?? "Задайте цену, ставку и полное распределение фонда" : null,
    settledSource: preview?.settled ?? false,
    personalQuantity: personalQuantity(allocation),
    splitRevision: task.splitRevision ?? 0,
    canSplit: actor ? canSplitTask(actor, { ...task, paidCount: task._count?.payrollEntries ?? 0 }) : false,
    canTransferPiecework: !!actor && !!task.work && ordinaryPieceworkBinding(task.work) && canTransferPiecework(actor, task) &&
      task._count?.payrollEntries === 0 && task._count.stageSettlementShares === 0 && !task.physicalOnlyShare && task.stageShareUnits == null &&
      (!task.allocationGroupId || task.allocationGroup?.budgetSource === "TASK_FIXED"),
    canReassignOrdinaryTask: !!actor && canReassignOrdinaryTask(actor.roles, { ...task, productId: task.product?.id ?? null, projectId: task.project.id }) &&
      task._count?.payrollEntries === 0 && task._count.stageSettlementShares === 0,
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
    files: fileViews.get(task.id) ?? [],
    createdAt: task.createdAt.toISOString(),
    doneAt: task.doneAt?.toISOString() ?? null,
    doneByName: task.doneById ? (userNames.get(task.doneById) ?? null) : null,
    createdByName: task.createdById
      ? (userNames.get(task.createdById) ?? null)
      : null,
  });
  });
}
