import { prisma } from "@/lib/prisma";
import { canManagePiecework, canTransferPiecework } from "@/lib/piecework-policy";
import { allocatedWorkQuantity, FULL_SHARE_UNITS, quantityAtoms, quantityFromAtoms, taskPieceAmount } from "@/lib/work-shares";
import { productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { liveChildWhere, liveProductWhere } from "@/server/access/live-entities";
import { pieceworkRecipientError } from "./piecework-policy";
import { pieceworkPlanRevision } from "./piecework-revision";

export type PieceworkOptions = { recipients: { id: string; name: string }[]; canCreate: boolean; transferable: boolean; works: { id: string; remaining: string; priceSnapshot: string; revision: string }[];
  source: { revision: number; shareUnits: number; amount: string; currency: string } | null };

export async function listPieceworkOptions(actorId: string, productId: string, taskId?: string): Promise<PieceworkOptions | null> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, active: true, roles: true } });
  if (!actor?.active) return null;
  const visibility = await resolveVisibilityActor(prisma, actor);
  const product = await prisma.product.findFirst({ where: { ...liveProductWhere, id: productId, AND: [productVisibilityWhere(visibility)] }, select: { id: true, projectId: true, engineerId: true, status: true } });
  if (!product) return null;
  const task = taskId ? await prisma.task.findFirst({ where: { ...liveChildWhere, id: taskId, productId: product.id, projectId: product.projectId,
    work: { is: { productId: product.id, projectId: product.projectId, paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null, paymentConversions: { none: {} }, settlementShares: { none: {} } } },
    physicalOnlyShare: false, stageShareUnits: null, payrollEntries: { none: {} }, stageSettlementShares: { none: {} },
  }, select: { assigneeId: true, status: true, allocationGroupId: true, quantity: true, executorShare: true, shareUnits: true, shareAmount: true, splitRevision: true,
    work: { select: { priceSnapshot: true } }, allocationGroup: { select: { budgetSource: true, currency: true } } } }) : null;
  const canCreate = canManagePiecework(actor.roles);
  let source: PieceworkOptions["source"] = null;
  if (task && canTransferPiecework(actor, task) && (!task.allocationGroupId || task.allocationGroup?.budgetSource === "TASK_FIXED")) {
    const currency = task.allocationGroup ? task.allocationGroup.currency : (await prisma.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
    try { if (currency === "BYN" && (task.allocationGroupId || task.work?.priceSnapshot !== null)) source = { revision: task.splitRevision,
      shareUnits: task.allocationGroupId ? task.shareUnits! : FULL_SHARE_UNITS, amount: taskPieceAmount(task, task.work?.priceSnapshot ?? "0"), currency }; }
    catch { /* Некорректная группа не предлагается к передаче. */ }
  }
  const transferable = source !== null;
  if (!canCreate && !transferable) return null;
  const [users, works] = await Promise.all([
    prisma.user.findMany({ where: { active: true, payScheme: "PIECE" }, select: { id: true, name: true, active: true, roles: true, payScheme: true }, orderBy: { name: "asc" } }),
    canCreate ? prisma.work.findMany({ where: { ...liveChildWhere, projectId: product.projectId, productId: product.id, paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null, priceSnapshot: { not: null }, paymentConversions: { none: {} }, settlementShares: { none: {} } }, include: { tasks: { select: { id: true, quantity: true, allocationGroupId: true } } } }) : [],
  ]);
  return {
    recipients: users.filter(user => user.id !== task?.assigneeId && pieceworkRecipientError(user, product) === null).map(({ id, name }) => ({ id, name })),
    canCreate, transferable, source,
    works: works.flatMap(work => {
      if (work.tasks.some(task => task.quantity === null)) return [];
      try { const remaining = quantityAtoms(work.quantity) - quantityAtoms(allocatedWorkQuantity(work.tasks)); return remaining > BigInt(0) && work.priceSnapshot !== null ? [{ id: work.id, remaining: quantityFromAtoms(remaining), priceSnapshot: work.priceSnapshot.toString(), revision: pieceworkPlanRevision(work) }] : []; }
      catch { return []; }
    }),
  };
}
