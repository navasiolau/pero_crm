import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { canEditOrdinaryWork } from "@/lib/ordinary-work-access";
import { assertInternalCurrency, assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { inputNorm, scaleNorm, workBudget } from "@/lib/product-quantity";
import { allocatedWorkQuantity, quantityAtoms } from "@/lib/work-shares";
import { productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { liveChildWhere, liveProductWhere, liveProjectWhere } from "@/server/access/live-entities";
import { lockProductRow } from "@/server/products/quantity-core";
import type { DomainActor } from "@/server/projects/core";
import { withTaskTransaction, type TaskTransaction } from "@/server/tasks/transaction";
import { isOrdinaryWork, workPlanRevision } from "./plan";

export const updateWorkSchema = z.object({
  projectId: z.string().min(1), productId: z.string().min(1), workId: z.string().min(1),
  priceItemId: z.string().min(1).optional(), quantity: z.number().positive().optional(),
  quantityPerUnit: z.number().positive().optional(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  clientMutationId: z.uuid(),
}).strict();
export type UpdateWorkInput = z.input<typeof updateWorkSchema>;
export type UpdateWorkResult = { ok: true; workId: string; quantity: string; revision: string;
  clientMutationId: string; repeated?: boolean } | { ok: false; kind: "validation" | "forbidden" | "conflict" | "failure"; error: string };
class WorkRule extends Error {
  constructor(message: string, readonly kind: Extract<UpdateWorkResult, { ok: false }>["kind"] = "validation") { super(message); }
}
function deny(message: string, kind?: Extract<UpdateWorkResult, { ok: false }>["kind"]): never { throw new WorkRule(message, kind); }
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function updateWorkCore(actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction): Promise<UpdateWorkResult> {
  const parsed = updateWorkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", error: parsed.error.issues[0]?.message ?? "Проверьте данные работы" };
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  try {
    return await transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, name: true, active: true, roles: true } });
      if (!current?.active) deny("Недостаточно прав", "forbidden");
      await lockProductRow(tx, data.productId);
      const visibility = await resolveVisibilityActor(tx, current);
      const product = await tx.product.findFirst({ where: { ...liveProductWhere, id: data.productId, projectId: data.projectId,
        AND: [productVisibilityWhere(visibility)] }, select: { id: true, status: true, quantity: true } });
      if (!product || !canEditOrdinaryWork(current.roles, product.status)) deny("Изделие недоступно для редактирования работы", "forbidden");
      const project = await tx.project.findUnique({ where: { ...liveProjectWhere, id: data.projectId }, select: { currency: true } });
      if (!project) deny("Проект недоступен", "forbidden");
      try { assertProjectMoneyCurrency(project.currency); } catch { deny("Цены проекта должны быть подготовлены в BYN"); }
      const payrollCurrency = (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
      try { assertInternalCurrency(payrollCurrency); } catch { deny("Валюта расчёта работ должна быть BYN"); }
      await tx.$queryRaw`SELECT id FROM "Work" WHERE id=${data.workId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Task" WHERE "workId"=${data.workId} ORDER BY id FOR UPDATE`;
      const work = await tx.work.findUnique({ where: { ...liveChildWhere, id: data.workId }, include: {
        tasks: { select: { id: true, quantity: true, allocationGroupId: true } },
        _count: { select: { paymentConversions: true, settlementShares: true } },
      } });
      if (!work || work.projectId !== data.projectId || work.productId !== data.productId) deny("Работа не найдена в этом изделии", "forbidden");
      if (!isOrdinaryWork(work) || work._count.paymentConversions || work._count.settlementShares) deny("Процентная или замороженная работа изменяется только своим специальным процессом");
      if (work.priceSnapshot === null) deny("У прежней работы не определён снимок расценки");
      if (work.tasks.some(task => task.quantity === null)) deny("В старой задаче не определён объём; редактирование плана недоступно");
      const revision = workPlanRevision(work);
      const receipt = await tx.changeLog.findUnique({ where: { id: `work-update:${data.clientMutationId}` } });
      if (receipt) {
        const saved = object(receipt.newValue), result = object(saved?.result);
        if (receipt.actorId !== current.id || receipt.entity !== "work" || receipt.entityId !== work.id || saved?.fingerprint !== fingerprint
          || result?.ok !== true || result.revision !== revision || result.workId !== work.id || typeof result.quantity !== "string") {
          deny("Работа или запрос уже изменились — обновите карточку", "conflict");
        }
        return { ok: true as const, workId: work.id, quantity: result.quantity, revision, clientMutationId: data.clientMutationId, repeated: true };
      }
      if (data.expectedRevision !== revision) deny("Работа или распределение изменились — обновите карточку", "conflict");
      let norm: string, quantity: string, allocated: string;
      try { norm = inputNorm(data, product.quantity, 2, 10); quantity = scaleNorm(norm, product.quantity, 2, 10); }
      catch { deny("Укажите положительную норму с двумя знаками после запятой в допустимом диапазоне"); }
      try { allocated = allocatedWorkQuantity(work.tasks); }
      catch { deny("Объём ранее распределённой работы не согласован"); }
      if (quantityAtoms(quantity) < quantityAtoms(allocated)) deny(`Уже распределено ${allocated}; объём работы не может быть меньше`, "conflict");
      let price = work.priceSnapshot, title = work.title, unit = work.unitSnapshot, priceItemId = work.priceItemId;
      if (data.priceItemId !== undefined && data.priceItemId !== work.priceItemId) {
        if (work.tasks.length || await tx.payrollEntry.count({ where: { workId: work.id } })) deny("Расценку нельзя менять после появления задач или начислений");
        await tx.$queryRaw`SELECT id FROM "PriceItem" WHERE id=${data.priceItemId} FOR UPDATE`;
        const item = await tx.priceItem.findUnique({ where: { id: data.priceItemId }, select: { id: true, active: true, name: true, unit: true, price: true } });
        if (!item?.active) deny("Выберите действующую расценку");
        price = item.price; title = item.name; unit = item.unit; priceItemId = item.id;
      }
      let total: string;
      try { total = workBudget(price, quantity); } catch { deny("Прежняя цена или новый объём не позволяют определить стоимость работы"); }
      const updated = await tx.work.update({ where: { id: work.id }, data: {
        quantity, quantityPerUnit: norm, title, unitSnapshot: unit, priceItemId, priceSnapshot: price, total,
      } });
      const result = { ok: true as const, workId: work.id, quantity, revision: workPlanRevision({ ...updated, tasks: work.tasks }), clientMutationId: data.clientMutationId };
      await tx.changeLog.create({ data: { actorType: "user", actorId: current.id, actorName: current.name, source: actor.source,
        entity: "work", entityId: work.id, action: "update", oldValue: { quantity: work.quantity.toString(), quantityPerUnit: work.quantityPerUnit?.toString() ?? null,
          priceItemId: work.priceItemId, priceSnapshot: work.priceSnapshot.toString(), unitSnapshot: work.unitSnapshot },
        newValue: { quantity, quantityPerUnit: norm, priceItemId, priceSnapshot: price.toString(), unitSnapshot: unit },
      } });
      await tx.changeLog.create({ data: { id: `work-update:${data.clientMutationId}`, actorType: "user", actorId: current.id,
        actorName: current.name, source: actor.source, entity: "work", entityId: work.id, action: "work-update.receipt",
        newValue: JSON.parse(JSON.stringify({ fingerprint, result })) as Prisma.InputJsonValue,
      } });
      return result;
    });
  } catch (error) {
    return error instanceof WorkRule ? { ok: false, kind: error.kind, error: error.message }
      : { ok: false, kind: "failure", error: "Не удалось подтвердить правку. Повторите прежний запрос." };
  }
}
