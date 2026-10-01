import type { Prisma, ProductStatus } from "@prisma/client";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import { productStatusLabels } from "@/lib/product-statuses";
import { decideProductPercentageStatus, percentageCompletionKinds } from "@/lib/product-percentage-status";
import { captureProductPercentageCompletion } from "@/server/product-percentage-pay/core";
import type { DomainActor } from "@/server/projects/core";

/** Все способы изменения статуса проходят эту транзакцию и один ролевой policy. */
export async function changeProductStatusTransaction(tx: Prisma.TransactionClient, actor: DomainActor,
  productId: string, toStatus: ProductStatus, comment?: string) {
  if (!Object.hasOwn(productStatusLabels, toStatus)) return { ok: false as const, error: "Неизвестный статус изделия" };
  const product = await tx.product.findUnique({ where: { id: productId }, include: {
    files: { where: { fileName: { endsWith: ".b3d", mode: "insensitive" } }, select: { id: true }, take: 1 },
    percentageConfigs: { where: { kind: "ENGINEERING" }, select: { participants: { where: { userId: actor.id }, select: { id: true } } } },
  } });
  if (!product) return { ok: false as const, error: "Изделие не найдено" };
  const legacyParticipant = await tx.task.findFirst({ where: { productId, assigneeId: actor.id, work: { paymentKind: "ENGINEERING" } }, select: { id: true } });
  const decision = decideProductPercentageStatus(actor.roles, { from: product.status, to: toStatus,
    assignedEngineer: product.engineerId === actor.id,
    participant: product.percentageConfigs.some((row) => row.participants.length > 0) || !!legacyParticipant,
    hasB3d: product.files.length > 0, noModel: product.noModel });
  if (!decision.allowed) return { ok: false as const, error: decision.error ?? "Недостаточно прав" };
  if (product.status === toStatus) return { ok: true as const, product, eventId: null,
    captured: [] as ("ENGINEERING" | "INSTALLATION")[] };
  const fromStatus = product.status;
  await tx.product.update({ where: { id: productId }, data: { status: toStatus, statusChangedAt: new Date() } });
  const kinds = percentageCompletionKinds(fromStatus, toStatus, hasAnyRole(actor.roles, MANAGER_ROLES));
  const captured: ("ENGINEERING" | "INSTALLATION")[] = [];
  for (const kind of kinds) if (await captureProductPercentageCompletion(tx, actor, productId, kind, toStatus) === "PENDING_FX") captured.push(kind);
  await tx.productStatusHistory.create({ data: { productId, fromStatus, toStatus,
    comment: comment?.trim() || null, changedById: actor.id } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: productId, action: "status", field: "status", oldValue: fromStatus, newValue: toStatus } });
  const event = await tx.domainEvent.create({ data: { type: "product.statusChanged", actor: actor.id,
    payload: { productId, number: product.number, from: fromStatus, to: toStatus } } });
  return { ok: true as const, product: { ...product, status: fromStatus }, eventId: event.id, captured };
}
