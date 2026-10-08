import type { Prisma, ProductStatus, ProjectStage } from "@prisma/client";
import { isPreContractProjectStage } from "@/lib/product-drafts";
import type { DomainActor } from "@/server/projects/core";

const SERVICE_STAGES: ProjectStage[] = ["PAUSED", "REFUSED"];

/** Вызывается после lockProjectRow: пауза/отказ не теряют подтверждённый этап. */
export async function productInitialStatus(tx: Prisma.TransactionClient, project: {
  id: string; stage: ProjectStage;
}): Promise<ProductStatus> {
  let stage = project.stage;
  if (SERVICE_STAGES.includes(stage)) {
    const previous = await tx.projectStageHistory.findFirst({
      where: { projectId: project.id, OR: [
        { toStage: { notIn: SERVICE_STAGES } },
        { fromStage: { notIn: SERVICE_STAGES } },
      ] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { toStage: true, fromStage: true },
    });
    // fromStage — подтверждённый этап самого свежего перехода, в том числе импорта.
    stage = previous
      ? (SERVICE_STAGES.includes(previous.toStage) ? previous.fromStage ?? "LEAD" : previous.toStage)
      : "LEAD";
  }
  return isPreContractProjectStage(stage) ? "DRAFT" : "PREPARATION";
}

/** Подтверждение заказа не завершает процентный этап и не создаёт начислений. */
export async function promoteProjectDrafts(tx: Prisma.TransactionClient, actor: DomainActor,
  projectId: string, changedAt: Date) {
  const drafts = await tx.product.findMany({
    where: { projectId, status: "DRAFT" },
    select: { id: true, number: true }, orderBy: { id: "asc" },
  });
  const eventIds: string[] = [];
  for (const product of drafts) {
    const changed = await tx.product.updateMany({
      where: { id: product.id, status: "DRAFT" }, data: { status: "PREPARATION", statusChangedAt: changedAt },
    });
    if (changed.count !== 1) throw new Error("Статус черновика изменён другим пользователем");
    await tx.productStatusHistory.create({ data: {
      productId: product.id, fromStatus: "DRAFT", toStatus: "PREPARATION",
      changedById: actor.id, comment: "Подтверждение договора проекта", createdAt: changedAt,
    } });
    await tx.changeLog.create({ data: {
      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "product", entityId: product.id, action: "status", field: "status",
      oldValue: "DRAFT", newValue: "PREPARATION", createdAt: changedAt,
    } });
    const event = await tx.domainEvent.create({ data: {
      type: "product.statusChanged", actor: actor.id,
      payload: { productId: product.id, number: product.number, from: "DRAFT", to: "PREPARATION", projectId, reason: "project.contract" },
    } });
    eventIds.push(event.id);
  }
  return { eventIds, productIds: drafts.map(product => product.id) };
}