import {liveProductWhere} from "@/server/access/live-entities";
import type { PrismaClient } from "@prisma/client";
import { moneyAtoms, personalQuantity, quantityFromAtoms } from "@/lib/work-shares";
import type { EngineeringFundView, EngineeringTaskView } from "@/lib/engineering-fund-view";
import { getEngineeringPreview } from "@/server/product-stage-pay/preview";

type Reader = Pick<PrismaClient, "product" | "orgSetting" | "payrollEntry">;

/** Карточка вызывается после getProductFor, для офисных ролей; mutation API
 * повторно проверяет роль, ревизии и весь состав под блокировкой. */
export async function getEngineeringFundView(db: Reader, productId: string, canManage: boolean): Promise<EngineeringFundView> {
  const product = await db.product.findUnique({ where: {...liveProductWhere, id: productId }, include: {
    project: { select: { currency: true } },
    stagePayPools: { where: { kind: "ENGINEERING" }, include: { settlement: { include: { shares: true } } } },
    works: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: {
      tasks: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { assignee: { select: { name: true } } } },
    } },
  } });
  if (!product) throw new Error("Изделие не найдено");
  const pool = product.stagePayPools.at(0) ?? null;
  let preview: Awaited<ReturnType<typeof getEngineeringPreview>> | null = null;
  let previewReason: string | null = null;
  try { preview = await getEngineeringPreview(db, productId); }
  catch (error) {
    previewReason = error instanceof Error && /курс/i.test(error.message) ? error.message : "Предварительная сумма недоступна. Проверьте распределение фонда";
  }
  const taskView = (task: (typeof product.works)[number]["tasks"][number]): EngineeringTaskView => {
    const saved = pool?.settlement?.shares.find((share) => share.taskId === task.id);
    return {
      id: task.id, title: saved?.taskTitleSnapshot ?? task.title, status: task.status, assigneeId: saved?.userId ?? task.assigneeId,
      assigneeName: saved?.userNameSnapshot ?? task.assignee?.name ?? null,
      quantity: saved ? personalQuantity({ quantity: saved.quantitySnapshot, executorShare: "1", allocationGroupId: "settled", shareUnits: saved.quantityShareUnitsSnapshot }) : personalQuantity(task),
      units: saved?.stageShareUnits ?? task.stageShareUnits, revision: task.splitRevision,
      amount: preview?.tasks.get(task.id)?.amount ?? null,
    };
  };
  const works = product.works.filter((work) => work.paymentKind === "ENGINEERING" && work.stagePayPoolId === pool?.id && work.projectId === product.projectId).map((work) => {
    const tasks = work.tasks.filter((task) => task.productId === productId && task.projectId === product.projectId).map(taskView);
    const saved = pool?.settlement?.shares.find((share) => share.workId === work.id);
    return { id: work.id, title: saved?.workTitleSnapshot ?? work.title, quantity: work.quantity.toString(), weightUnits: saved?.workWeightUnits ?? work.poolWeightUnits ?? 0, tasks,
      amount: tasks.length && tasks.every((task) => task.amount !== null) ? quantityFromAtoms(tasks.reduce((sum, task) => sum + moneyAtoms(task.amount!), BigInt(0))) : null };
  });
  const legacy = canManage ? product.works.filter((work) => work.paymentKind === "LEGACY" && work.projectId === product.projectId) : [];
  const paid = legacy.length ? await db.payrollEntry.findMany({ where: { OR: [
    { workId: { in: legacy.map((work) => work.id) } }, { taskId: { in: legacy.flatMap((work) => work.tasks.map((task) => task.id)) } },
  ] }, select: { workId: true, taskId: true } }) : [];
  const candidates = legacy.map((work) => {
    const validContext = work.tasks.every((task) => task.productId === productId && task.projectId === product.projectId);
    return { id: work.id, title: work.title, quantity: work.quantity.toString(),
      disabledReason: !validContext ? "Проверьте связь задач с изделием" : work.tasks.length === 0 ? "Сначала добавьте задачи работы"
        : paid.some((entry) => entry.workId === work.id || work.tasks.some((task) => task.id === entry.taskId)) ? "По работе уже есть начисления" : null,
      tasks: validContext ? work.tasks.map(taskView) : [],
    };
  });
  const state = pool?.state ?? "ABSENT";
  const amount = preview?.amount ?? null;
  if (state === "DRAFT" && amount === null && !previewReason)
    previewReason = product.expectedPrice === null ? "Цена изделия не задана" : pool?.ratePercent === null ? "Ставка не задана" : "Добавьте работы и распределите 100% фонда и каждой работы";
  return {
    productId, poolId: pool?.id ?? null, revision: pool?.revision ?? 0, productStatus: product.status, state,
    primaryEngineerId: product.engineerId, priceBasis: (pool?.settlement?.priceSnapshot ?? product.expectedPrice)?.toString() ?? null,
    productCurrency: pool?.settlement?.productCurrency ?? product.project.currency,
    ratePercent: (pool?.settlement?.ratePercentSnapshot ?? pool?.ratePercent)?.toString() ?? null,
    amount, currency: preview?.currency ?? null, previewReason, closedAt: pool?.settlement?.closedAt.toISOString() ?? null,
    canClose: state === "DRAFT" && product.status === "DESIGN" && !!product.engineerId && amount !== null && works.length > 0 && works.every((work) => work.tasks.length > 0 && work.tasks.every((task) => task.status === "DONE")),
    works, candidates,
  };
}
