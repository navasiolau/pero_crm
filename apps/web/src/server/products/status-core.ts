import {liveProductWhere,liveProjectWhere} from "@/server/access/live-entities";
import {lockProjectRow} from "@/server/projects/lock";
import {lockProductRow} from "./quantity-core";
import {canAccessProductDraft,isProductDraftLocked} from "@/lib/product-drafts";
import {productDraftAccessRelations} from "@/server/access/product-draft-context";
import type { Prisma, ProductStatus } from "@prisma/client";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import { productStatusLabels } from "@/lib/product-statuses";
import { decideProductPercentageStatus, percentageCompletionKinds } from "@/lib/product-percentage-status";
import { captureProductPercentageCompletion } from "@/server/product-percentage-pay/core";
import type { PercentageAccrualEffects } from "@/server/product-percentage-pay/direct-completion";
import type { DomainActor } from "@/server/projects/core";

/** Все способы изменения статуса проходят эту транзакцию и один ролевой policy. */
export async function changeProductStatusTransaction(tx: Prisma.TransactionClient, actor: DomainActor,
  productId: string, toStatus: ProductStatus, comment?: string) {
  if (!Object.hasOwn(productStatusLabels, toStatus)) return { ok: false as const, error: "Неизвестный статус изделия" };
  const reference = await tx.product.findUnique({ where: {...liveProductWhere, id: productId }, select: {projectId:true} });
  if (!reference) return { ok: false as const, error: "Изделие не найдено" };
  await lockProjectRow(tx, reference.projectId);
  await lockProductRow(tx, productId);
  const product = await tx.product.findUnique({ where: {...liveProductWhere, id: productId }, include: productDraftAccessRelations });
  if (!product) return { ok: false as const, error: "Изделие не найдено" };
  const decision = decideProductPercentageStatus(actor.roles, { from: product.status, to: toStatus,
    assignedEngineer: product.engineerId === actor.id, canAccessDraft: canAccessProductDraft(actor.roles, product),
    participant: false, hasB3d: false, noModel: false });
  if (!decision.allowed) return { ok: false as const, error: decision.error ?? "Недостаточно прав" };
  if (product.status === toStatus) return { ok: true as const, product, eventId: null,
    captured: [] as ("ENGINEERING" | "ASSEMBLY" | "INSTALLATION")[], percentageEffects: {eventIds:[],earnings:[]} as PercentageAccrualEffects };
  if (product.status === "DRAFT") {
    const project = await tx.project.findUnique({where:{...liveProjectWhere,id:product.projectId},select:{stage:true}});
    if (!project) return {ok:false as const,error:"Проект не найден"};
    if (isProductDraftLocked(product.status,project.stage)) return {ok:false as const,error:"Переведите проект в статус «Договор», чтобы вывести изделие из черновика"};
  }
  const fromStatus = product.status;
  await tx.product.update({ where: { id: productId }, data: { status: toStatus, statusChangedAt: new Date() } });
  const kinds = percentageCompletionKinds(fromStatus, toStatus, hasAnyRole(actor.roles, MANAGER_ROLES));
  const captured: ("ENGINEERING" | "ASSEMBLY" | "INSTALLATION")[] = [];
  const percentageEffects: PercentageAccrualEffects = {eventIds:[],earnings:[]};
  for (const kind of kinds) {
    const state=await captureProductPercentageCompletion(tx, actor, productId, kind, toStatus, percentageEffects, fromStatus);
    if(state === "PENDING_FX" || state === "SETTLED") captured.push(kind);
  }
  await tx.productStatusHistory.create({ data: { productId, fromStatus, toStatus,
    comment: comment?.trim() || null, changedById: actor.id } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: productId, action: "status", field: "status", oldValue: fromStatus, newValue: toStatus } });
  const event = await tx.domainEvent.create({ data: { type: "product.statusChanged", actor: actor.id,
    payload: { productId, number: product.number, from: fromStatus, to: toStatus } } });
  return { ok: true as const, product: { ...product, status: fromStatus }, eventId: event.id, captured, percentageEffects };
}
