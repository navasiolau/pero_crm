import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { productVisibilityWhere, taskVisibilityWhere } from "@/server/access/visibility";
import { liveTaskWhere, liveWorkWhere, liveProductWhere, activeTaskDependencyWhere } from "@/server/access/live-entities";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { allocatedWorkQuantity, quantityAtoms, quantityFromAtoms } from "@/lib/work-shares";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { taskRecipientError, engineeringRecipientError } from "./share-policy";
import { taskEditReversalKind, taskEditReversalSchema, trackedRevision, type TaskEditReversal } from "./edit-reversal-contract";
import { bumpEngineeringPoolRevision } from "@/server/product-stage-pay/core";
import { operationJournalContext, journalSnapshot, journalUserReferences, journalTaskReferences, systemJournalActor, TASK_JOURNAL_FIELDS } from "./journal";

export async function checkWorkQuantity(
  tx: Prisma.TransactionClient,
  workId: string,
  quantity: number | null,
  excludeTaskId?: string,
  context?: { projectId: string; productId: string | null },
): Promise<{ error?: string; remaining?: string }> {
  const work = await tx.work.findUnique({
    where: {...liveWorkWhere, id: workId },
    include: { tasks: { where: { deletedAt: null }, select: { id: true, quantity: true, allocationGroupId: true } } },
  });
  if (!work) return { error: "Работа не найдена" };
  if(!work.productId||!context?.productId)return {error:'Задача должна относиться к работе конкретного изделия'};
  if(work.priceSnapshot===null)return {error:'У выбранной работы отсутствует снимок расценки'};
  if (context && (work.projectId !== context.projectId || work.productId !== context.productId)) return { error: "Выберите работу этого проекта и изделия" };
  const used = quantityAtoms(allocatedWorkQuantity(work.tasks.filter((task) => task.id !== excludeTaskId)));
  const remaining = quantityAtoms(work.quantity) - used;
  let qty: bigint;
  try { qty = quantity === null ? remaining : quantityAtoms(quantity); }
  catch { return { error: "Количество должно содержать не больше двух знаков после запятой" }; }
  if (qty <= BigInt(0)) return { error: "Количество должно быть больше нуля" };
  if (qty > remaining) {
    return {
      error: `В работе осталось ${quantityFromAtoms(remaining)} из ${work.quantity} — больше распределить нельзя`,
    };
  }
  return { remaining: quantityFromAtoms(qty) };
}

async function hasCycle(tx: Prisma.TransactionClient, taskId: string, dependencyIds: string[]) {
  const seen = new Set<string>();
  const queue = [...dependencyIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const next = await tx.taskDependency.findMany({
      where: { taskId: current },
      select: { dependsOnId: true },
    });
    queue.push(...next.map((edge) => edge.dependsOnId));
  }
  return false;
}

export async function expandDependencies(tx: Prisma.TransactionClient, actor: Pick<DomainActor, "id" | "roles">, projectId: string, selectedIds: string[], taskId?: string): Promise<{ ids: string[]; error?: string }> {
  const requested = [...new Set(selectedIds)];
  if (!requested.length) return { ids: [] };
  const selected = await tx.task.findMany({ where: { ...liveTaskWhere, projectId, AND: [taskVisibilityWhere(actor)], id: { in: requested } }, select: { id: true, allocationGroupId: true } });
  if (selected.length !== requested.length) return { ids: [], error: "Одна из выбранных зависимостей не найдена" };
  const groupIds = [...new Set(selected.map((task) => task.allocationGroupId).filter((id): id is string => !!id))];
  const parts = groupIds.length ? await tx.task.findMany({ where: { ...liveTaskWhere, projectId, AND: [taskVisibilityWhere(actor)], allocationGroupId: { in: groupIds } }, select: { id: true } }) : [];
  const ids = [...new Set([...selected, ...parts].map((task) => task.id))];
  if (taskId && (ids.includes(taskId) || await hasCycle(tx, taskId, ids))) return { ids: [], error: "Зависимость образует цикл или включает собственную группу долей" };
  return { ids };
}

export const updateSchema = z.object({
  title: z.string().min(1, "Укажите название задачи").optional(),
  type: z.string().min(1, "Укажите тип задачи").optional(),
  assigneeId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(), // изделие проекта (можно очистить)
  workId: z.string().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  dueAt: z.string().min(1, "Укажите срок").optional(),
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  dependencyIds: z.array(z.string()).optional(),
}).strict().superRefine((data,ctx)=>{
  for(const key of ['productId','workId','assigneeId'] as const)if(data[key]!==undefined&&!data[key]?.trim())ctx.addIssue({code:'custom',path:[key],message:'Нельзя очистить изделие, работу или исполнителя задачи'});
});

// Редактирование задачи — админ/директор/менеджер (§4).
// Закрытая (выполненная) задача — только просмотр, правок не принимаем.
// Назначение исполнителя черновику переводит его в «Новая» и шлёт уведомление.

export type TaskUpdateData = Omit<z.infer<typeof updateSchema>, "type" | "dueAt"> & {
  type?: string | null; dueAt?: string | null;
};

type TaskEditRow = {
  title: string; type: string | null; dueAt: Date | null; productId: string | null; workId: string | null;
  assigneeId: string | null; quantity: Prisma.Decimal | null; status: string;
  journalFieldRevisions: Prisma.JsonValue; journalDependencyRevision: number;
};
function editSnapshot(task: TaskEditRow, dependencies: string[]) {
  return { title: task.title, type: task.type, dueAt: task.dueAt?.toISOString() ?? null,
    productId: task.productId, workId: task.workId, assigneeId: task.assigneeId,
    quantity: task.quantity?.toString() ?? null, status: task.status, dependencyIds: [...dependencies].sort() };
}
function revisionFor(task: TaskEditRow, field: string) {
  return field === "dependencyIds" ? task.journalDependencyRevision : trackedRevision(task.journalFieldRevisions, field);
}
function editInverse(before: TaskEditRow, after: TaskEditRow, oldDependencies: string[], newDependencies: string[]) {
  const prior = editSnapshot(before, oldDependencies);
  const next = editSnapshot(after, newDependencies);
  const keys = (Object.keys(prior) as (keyof typeof prior)[]).filter(key => JSON.stringify(prior[key]) !== JSON.stringify(next[key]));
  if (!keys.length) return null;
  const projectBinding: (keyof typeof prior)[] = ["workId", "productId", "quantity", "assigneeId", "status"];
  const relevant = keys.some(key => projectBinding.includes(key)) ? [...new Set([...keys, ...projectBinding])] :
    keys.includes("dependencyIds") ? [...keys, "status" as const] : keys;
  return taskEditReversalSchema.parse({
    restore: Object.fromEntries(keys.map(key => [key, prior[key]])),
    expected: Object.fromEntries(relevant.map(key => [key, next[key]])),
    revisions: Object.fromEntries(relevant.map(key => [key, revisionFor(after, key)])),
  });
}
export async function updateTaskInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, taskId: string, data: TaskUpdateData, reversal?: TaskEditReversal, preview = false) {
  const liveActor = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, roles: true, active: true } });
  if (!liveActor?.active || !hasAnyRole(liveActor.roles, MANAGER_ROLES)) return { ok: false as const, error: "Недостаточно прав" };
  actor = { ...actor, roles: liveActor.roles };
  if (!preview) await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
  const task = await tx.task.findUnique({
    where: {...liveTaskWhere, id: taskId, AND: [taskVisibilityWhere(actor)] },
    include: { project: { select: { id: true, number: true, currency: true } }, product: { select: { id:true,number:true,engineerId: true, status: true, projectId: true } },
      work: { select: { deletedAt: true, paymentKind: true, projectId: true, productId: true, stagePayPoolId: true, stagePayPool: { select: { id: true, kind: true, state: true, productId: true } } } },
      dependencies:{where:activeTaskDependencyWhere,select:{dependsOnId:true}},_count: { select: { payrollEntries: true, timeEntries: true, stageSettlementShares: true } } },
  });
  if (!task || task.work?.deletedAt) return { ok: false as const, error: "Задача не найдена" };
  const oldDependencyIds = (task.dependencies ?? []).map(edge => edge.dependsOnId).sort();
  if (reversal) {
    if (task.work?.paymentKind !== "LEGACY" || task.allocationGroupId || task._count.timeEntries || task._count.stageSettlementShares)
      return { ok: false as const, error: "История или распределение задачи изменились" };
    const current = editSnapshot(task, oldDependencyIds);
    const fields = Object.keys(reversal.expected) as (keyof typeof current)[];
    if (fields.some(key => reversal.revisions[key] !== revisionFor(task, key) ||
        JSON.stringify(reversal.expected[key]) !== JSON.stringify(current[key])))
      return { ok: false as const, error: "Изменённые поля задачи уже обновились" };
  }
  if (task.work?.paymentKind === "LEGACY" && data.assigneeId !== undefined && data.assigneeId !== task.assigneeId)
    return { ok: false as const, error: "Для смены исполнителя используйте действие «Переназначить»" };
  if (data.workId !== undefined || data.quantity !== undefined) {
    try { assertProjectMoneyCurrency(task.project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
  }
  const engineering = task.work?.paymentKind === "ENGINEERING";
  let engineeringPoolId: string | null = null;
  if (engineering) {
    if((data.assigneeId!==undefined&&data.assigneeId!==task.assigneeId)||(data.quantity!==undefined&&String(data.quantity)!==String(task.quantity)))return {ok:false as const,error:'Перераспределение исторической инженерной оплаты недоступно'};
    const pool = task.work?.stagePayPool;
    if (!task.productId || task.product?.status !== "DESIGN" || task.product.projectId !== task.projectId ||
      task.work?.projectId !== task.projectId || task.work.productId !== task.productId ||
      !pool || pool.kind !== "ENGINEERING" || pool.state !== "DRAFT" || pool.productId !== task.productId)
      return { ok: false as const, error: "Инженерную задачу можно менять только на проектировании до начисления" };
    if ((data.workId !== undefined && data.workId !== task.workId) || (data.productId !== undefined && data.productId !== task.productId))
      return { ok: false as const, error: "Нельзя переносить задачу между инженерными фондами" };
    if (await tx.payrollEntry.count({ where: { workId: task.workId } })) return { ok: false as const, error: "По инженерной работе уже есть начисление" };
    engineeringPoolId = pool.id;
  }
  if (data.workId && data.workId !== task.workId) {
    const targetWork = await tx.work.findUnique({ where: {...liveWorkWhere, id: data.workId }, select: { paymentKind: true } });
    if (targetWork?.paymentKind === "ENGINEERING") return { ok: false as const, error: "Инженерная работа требует настройки полного распределения долей" };
  }
  if (task.status === "DONE" || task._count.payrollEntries > 0) {
    return { ok: false as const, error: "Выполненная или начисленная задача — только просмотр" };
  }
  if (task.allocationGroupId && (
    (data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) ||
    (data.workId !== undefined && data.workId !== task.workId) ||
    (data.productId !== undefined && data.productId !== task.productId) ||
    (data.quantity !== undefined && String(data.quantity) !== String(task.quantity))
  )) {
    return { ok: false as const, error: "Исполнитель, объём, работа и изделие общей доли зафиксированы" };
  }

  // Изделие должно принадлежать проекту задачи
  let product = data.productId === null ? null : task.product;
  if (data.productId) {
    product = await tx.product.findFirst({
      where: {...liveProductWhere, id: data.productId, projectId: task.project.id, AND: [productVisibilityWhere(actor)] },
      select: { id:true,number:true,engineerId: true, status: true, projectId: true },
    });
    if (!product) return { ok: false as const, error: "Изделие не найдено в этом проекте" };
  }
  const nextAssigneeId = data.assigneeId === undefined ? task.assigneeId : data.assigneeId;
  if (nextAssigneeId) {
    const assignee = await tx.user.findUnique({ where: { id: nextAssigneeId }, select: { id: true, roles: true, active: true } });
    const error = assignee ? (engineering ? engineeringRecipientError(assignee, product) : taskRecipientError(assignee, product)) : "Сотрудник не найден";
    if (error) return { ok: false as const, error };
  }

  const nextProductId=data.productId===undefined?task.productId:data.productId;
  const effectiveWorkId=data.workId===undefined?task.workId:data.workId;
  if(!nextProductId||!effectiveWorkId||!nextAssigneeId)return {ok:false as const,error:'Выберите изделие, работу и одного исполнителя'};
  if(!engineering){
    const currentProduct=await tx.product.findFirst({where:{...liveProductWhere,id:nextProductId,projectId:task.projectId,AND:[productVisibilityWhere(actor)]},select:{id:true}});
    const currentWork=await tx.work.findUnique({where:{...liveWorkWhere,id:effectiveWorkId},select:{projectId:true,productId:true,priceSnapshot:true,paymentKind:true}});
    if(!currentProduct||!currentWork||currentWork.projectId!==task.projectId||currentWork.productId!==nextProductId)return {ok:false as const,error:'Выберите работу этого живого изделия'};
    const frozenSnapshot=task.allocationGroupId&&effectiveWorkId===task.workId&&nextProductId===task.productId&&nextAssigneeId===task.assigneeId;
    if(currentWork.priceSnapshot===null&&!frozenSnapshot)return {ok:false as const,error:'У выбранной работы отсутствует снимок расценки'};
  }

  const becameAssigned =
    data.assigneeId && data.assigneeId !== task.assigneeId;
  const reassignedEngineering = engineering && data.assigneeId !== undefined && data.assigneeId !== task.assigneeId;
  const newStatus = reversal?.restore.status ?? (reassignedEngineering ? (data.assigneeId ? "NEW" : "DRAFT")
    : task.status === "DRAFT" && data.assigneeId ? "NEW" : task.status);

  const newWorkId =
    data.workId === undefined ? task.workId : data.workId;
  let quantityValue: string | null | undefined = undefined;
  if (!task.allocationGroupId && (data.workId !== undefined || data.quantity !== undefined || data.productId !== undefined)) {
    if (newWorkId) {
      const check = await checkWorkQuantity(
        tx,
        newWorkId,
        data.quantity ?? (task.quantity ? Number(task.quantity) : null),
        taskId,
        { projectId: task.projectId, productId: data.productId === undefined ? task.productId : data.productId },
      );
      if (check.error) return { ok: false as const, error: check.error };
      quantityValue = check.remaining!;
    } else {
      quantityValue = null;
    }
  }

  const dependencies = data.dependencyIds === undefined ? null : await expandDependencies(tx, actor, task.projectId, data.dependencyIds, taskId);
  if (dependencies?.error) return { ok: false as const, error: dependencies.error };
  if (preview) return { ok: true as const, task, becameAssigned, inverse: null };
  const updated=await tx.task.update({
    where: { id: taskId },
    data: {
      title: data.title,
      type: data.type,
      assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
      productId: data.productId === undefined ? undefined : data.productId,
      workId: data.workId === undefined ? undefined : data.workId,
      quantity: quantityValue,
      dueAt: data.dueAt === null ? null : data.dueAt ? new Date(data.dueAt) : undefined,
      status: newStatus,
      splitRevision: { increment: 1 },
    },
  });

  // Зависимости (DAG, §9): заменяем список, без самоссылок и циклов
  const newDependencyIds = [...(dependencies?.ids ?? oldDependencyIds)].sort();
  const removed = oldDependencyIds.filter(id => !newDependencyIds.includes(id));
  const added = newDependencyIds.filter(id => !oldDependencyIds.includes(id));
  if (removed.length) await tx.taskDependency.deleteMany({ where: { taskId, dependsOnId: { in: removed } } });
  if (added.length) await tx.taskDependency.createMany({ data: added.map(dependsOnId => ({ taskId, dependsOnId })) });
  const afterTask = added.length || removed.length ? await tx.task.findUniqueOrThrow({ where: { id: task.id } }) : updated;
  const inverse = !engineering && !task.allocationGroupId && !task._count.timeEntries && !task._count.stageSettlementShares
    ? editInverse(task, afterTask, oldDependencyIds, newDependencyIds) : null;
  if (engineeringPoolId) await bumpEngineeringPoolRevision(tx, engineeringPoolId);
  const journal=await operationJournalContext(tx,{type:'task',id:task.id,label:updated.title},[task,{...updated,project:task.project}],
    [...await journalUserReferences(tx,[task.assigneeId,updated.assigneeId]),...await journalTaskReferences(tx,[...(task.dependencies??[]).map(edge=>edge.dependsOnId),...(dependencies?.ids??[])])]);
  const beforeSnapshot={...journalSnapshot(task,TASK_JOURNAL_FIELDS),dependencyIds:(task.dependencies??[]).map(edge=>edge.dependsOnId).sort()};
  const afterSnapshot={...journalSnapshot(updated,TASK_JOURNAL_FIELDS),status:task.status,dependencyIds:[...(dependencies?.ids??(task.dependencies??[]).map(edge=>edge.dependsOnId))].sort()};
  if (!reversal) await writeChangeLogInTransaction(tx, {
    ...(inverse ? { reversal: { kind: taskEditReversalKind, version: 1, data: inverse } } : {}),
    actorType: "user", actorId: actor.id, actorName: actor.name ?? undefined,
    entity: "task", entityId: taskId, action: "update", source: actor.source,
    oldValue: JSON.parse(JSON.stringify({ title: task.title, type: task.type, assigneeId: task.assigneeId,
      dueAt: task.dueAt, status: task.status })) as Prisma.InputJsonValue,
    newValue: JSON.parse(JSON.stringify({ ...data, status: newStatus })) as Prisma.InputJsonValue,
  },{...journal,before:beforeSnapshot,after:afterSnapshot,kind:JSON.stringify(beforeSnapshot)===JSON.stringify(afterSnapshot)?'receipt':'event'});
  if(!reversal && newStatus!==task.status)await writeChangeLogInTransaction(tx,{actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'task',entityId:task.id,
    action:'status',field:'status',oldValue:task.status,newValue:newStatus},
    {...journal,...systemJournalActor({id:actor.id,name:actor.name},'Назначение исполнителя задачи')});
  return { ok: true as const, task, afterTask, becameAssigned, inverse, hints: journal, beforeSnapshot, afterSnapshot };

}
