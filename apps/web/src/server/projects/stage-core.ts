import { Prisma, ProjectStage } from "@prisma/client";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor, StageExtras } from "./core";

export type LegacyEarning = { userId: string; name: string; amount: string; percent: string; currency: string };

/** Вызывается только внутри withTaskTransaction — та же блокировка, что у
 * ENGINEERING. Старые записи не меняются; покрытие фиксируется по изделиям. */
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
  if (toStage === "REFUSED" && (!extras?.refusalReason?.trim() || !extras?.refusalComment?.trim()))
    return { ok: false as const, error: "Для отказа нужны причина и комментарий" };
  if (toStage === "RECLAMATION") {
    if (project.stage !== "DONE") return { ok: false as const, error: "Рекламация открывается только из «Завершён»" };
    if (!extras?.reclamationReason?.trim() || !extras?.reclamationDescription?.trim() || !extras?.reclamationFault?.trim())
      return { ok: false as const, error: "Для рекламации нужны причина, описание и виновная сторона" };
  }
  const now = new Date();
  await tx.project.update({ where: { id: projectId }, data: {
    stage: toStage, stageChangedAt: now,
    ...(toStage === "REFUSED" ? { refusalReason: extras!.refusalReason, refusalComment: extras!.refusalComment } : {}),
    ...(toStage === "RECLAMATION" ? { reclamationReason: extras!.reclamationReason, reclamationDescription: extras!.reclamationDescription, reclamationFault: extras!.reclamationFault } : {}),
  } });
  await tx.projectStageHistory.create({ data: {
    projectId, fromStage: project.stage, toStage, changedById: actor.id,
    comment: toStage === "REFUSED" ? extras!.refusalReason : toStage === "RECLAMATION" ? extras!.reclamationReason : undefined,
  } });

  if (toStage === "IN_WORK" && !await tx.payrollEntry.findFirst({ where: { projectId, scheme: "PERCENT_PROJECT" }, select: { id: true } })) {
    const products = await tx.product.findMany({
      where: { projectId, stagePayPools: { none: { kind: "ENGINEERING" } } },
      select: { id: true, engineerId: true, expectedPrice: true },
    });
    const priceByEngineer = new Map<string, Prisma.Decimal>();
    for (const product of products) if (product.engineerId) {
      priceByEngineer.set(product.engineerId, (priceByEngineer.get(product.engineerId) ?? new Prisma.Decimal(0)).plus(product.expectedPrice ?? 0));
    }
    const currency = (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
    const payrollIds: string[] = [];
    for (const [userId, total] of priceByEngineer) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, payScheme: true, payPercent: true } });
      if (user?.payScheme !== "PERCENT_PROJECT" || !user.payPercent || new Prisma.Decimal(user.payPercent).lte(0)) continue;
      const amount = total.mul(user.payPercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (amount.lte(0)) continue;
      const percent = user.payPercent.toString();
      const entry = await tx.payrollEntry.create({ data: {
        userId, projectId, amount, currency, scheme: "PERCENT_PROJECT", month: now.toISOString().slice(0, 7),
        comment: `${percent}% от стоимости изделий · ${project.number}`,
      } });
      payrollIds.push(entry.id);
      earnings.push({ userId, name: user.name, amount: amount.toFixed(2), percent, currency });
      const event = await tx.domainEvent.create({ data: {
        type: "payroll.accrued", actor: actor.id,
        payload: { userId, projectId, scheme: "PERCENT_PROJECT", amount: amount.toNumber() },
      } });
      eventIds.push(event.id);
    }
    // Старый writer — один раз на проект. Консервативно защищаем весь набор
    // legacy-изделий этого перехода; индивидуальные прошлые суммы не выдумываем.
    if (payrollIds.length) for (const product of products) await tx.productStagePayPool.create({ data: {
      productId: product.id, kind: "ENGINEERING", state: "LEGACY_PROTECTED",
      legacyProjectId: projectId, legacyPayrollEntryIds: payrollIds, legacyProtectedAt: now, createdById: actor.id,
    } });
  }
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
