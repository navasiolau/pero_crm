import { Prisma, ProjectStage } from "@prisma/client";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor, StageExtras } from "./core";

export type LegacyEarning = { userId: string; name: string; amount: string; percent: string; currency: string };

/** Проектный этап не создаёт новых процентных начислений по изделиям. */
export async function changeProjectStageTransaction(
  actor: DomainActor, projectId: string, toStage: ProjectStage,
  extras: StageExtras | undefined, tx: Prisma.TransactionClient,
) {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
  if (!Object.values(ProjectStage).includes(toStage)) return { ok: false as const, error: "Неизвестный этап проекта" };
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false as const, error: "Проект не найден" };
  const eventIds: string[] = [];
  const earnings: LegacyEarning[] = [];
  if (project.stage === toStage) return { ok: true as const, repeated: true, project, eventIds, earnings };
  const now = new Date();
  await tx.project.update({ where: { id: projectId }, data: {
    stage: toStage, stageChangedAt: now,
    ...(toStage === "REFUSED" && extras ? { refusalReason: extras.refusalReason, refusalComment: extras.refusalComment } : {}),
    ...(toStage === "RECLAMATION" && extras ? { reclamationReason: extras.reclamationReason, reclamationDescription: extras.reclamationDescription, reclamationFault: extras.reclamationFault } : {}),
  } });
  await tx.projectStageHistory.create({ data: {
    projectId, fromStage: project.stage, toStage, changedById: actor.id,
    comment: toStage === "REFUSED" ? extras?.refusalReason : toStage === "RECLAMATION" ? extras?.reclamationReason : undefined,
  } });

  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "project", entityId: projectId, action: "stage", field: "stage", oldValue: project.stage, newValue: toStage,
  } });
  const event = await tx.domainEvent.create({ data: {
    type: "project.stageChanged", actor: actor.id,
    payload: { projectId, number: project.number, from: project.stage, to: toStage },
  } });
  eventIds.push(event.id);
  return { ok: true as const, repeated: false, project, eventIds, earnings };
}
