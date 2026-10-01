import type { PrismaClient, Role } from "@prisma/client";
import type { ProductPercentageView, ProductPercentageSectionView } from "@/lib/product-percentage-view";
import { allocatePercentageShares, calculateProductCurrencyPercentage } from "@/lib/product-percentage-pay";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { hasFullProjectVisibility, productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

type Reader = Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">;
export async function getProductPercentageView(actor: { id: string; roles: Role[] }, productId: string,
  database: Reader = prisma): Promise<ProductPercentageView> {
  const visibilityActor = await resolveVisibilityActor(database, actor);
  const product = await database.product.findFirst({ where: { AND: [{ id: productId }, productVisibilityWhere(visibilityActor)] },
    include: { project: { select: { currency: true } }, engineer: { select: { name: true } },
      percentageConfigs: { include: { participants: { include: { user: { select: { name: true } } } } } },
      percentageCompletions: { include: { shares: true } },
      stagePayPools: { where: { kind: "ENGINEERING" }, include: { settlement: true } },
      works: { where: { paymentKind: { in: ["LEGACY", "INSTALLATION"] } },
        select: { id: true, title: true, paymentKind: true, projectId: true, stagePayPoolId: true, poolWeightUnits: true,
          tasks: { select: { id: true, projectId: true, productId: true } } } },
      files: { where: { fileName: { endsWith: ".b3d", mode: "insensitive" } }, select: { id: true }, take: 1 },
    } });
  if (!product) throw new Error("Изделие не найдено");
  const manager = hasAnyRole(actor.roles, MANAGER_ROLES);
  const financeView = hasFullProjectVisibility(visibilityActor);
  const [engineers, mounters] = await Promise.all([
    database.user.findMany({ where: { active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true, name: true } }),
    database.user.findMany({ where: { active: true, roles: { hasSome: ["MOUNTER"] } }, select: { id: true, name: true } }),
  ]);
  const workIds = manager ? product.works.map((work) => work.id) : [];
  const taskIds = manager ? product.works.flatMap((work) => work.tasks.map((task) => task.id)) : [];
  const paid = manager && workIds.length ? await database.payrollEntry.findMany({ where: {
    OR: [{ workId: { in: workIds } }, { taskId: { in: taskIds } }],
  }, select: { workId: true, taskId: true } }) : [];
  const sections = Object.fromEntries((["ENGINEERING", "INSTALLATION"] as const).map((kind) => {
    const config = product.percentageConfigs.find((row) => row.kind === kind);
    const completion = product.percentageCompletions.find((row) => row.kind === kind);
    const editableAfterSkip = completion?.state === "SKIPPED_ONCE";
    const displayCompletion = editableAfterSkip ? null : completion;
    const pool = kind === "ENGINEERING" ? product.stagePayPools.at(0) : null;
    let draftAmounts = new Map<string, string>();
    let draftTotal: string | null = null;
    if ((!completion || editableAfterSkip) && config?.ratePercent !== null && config?.ratePercent !== undefined && product.expectedPrice !== null) {
      try {
        const total = calculateProductCurrencyPercentage(product.expectedPrice.toString(), config.ratePercent.toString());
        draftAmounts = new Map(allocatePercentageShares(total,
          config.participants.map((row) => ({ userId: row.userId, shareUnits: row.shareUnits })))
          .map((row) => [row.userId, row.amount]));
        draftTotal = total;
      } catch { /* неполная конфигурация не становится расчётом */ }
    }
    const legacyPaidSummary = financeView && pool?.settlement
      ? { amount: pool.settlement.amount.toString(), currency: pool.settlement.payrollCurrency, count: 1 } : null;
    const members = displayCompletion?.shares.length
      ? displayCompletion.shares.map((row) => ({ userId: row.userId, name: row.userNameSnapshot, shareUnits: row.shareUnits,
          amount: row.amount?.toString() ?? null }))
      : config?.participants.map((row) => ({ userId: row.userId, name: row.user.name, shareUnits: row.shareUnits,
          amount: draftAmounts.get(row.userId) ?? null }))
        ?? (kind === "ENGINEERING" && product.engineerId && product.engineer
          ? [{ userId: product.engineerId, name: product.engineer.name, shareUnits: 1000000, amount: null }] : []);
    const ownMember = members.find((row) => row.userId === actor.id) ?? null;
    const view: ProductPercentageSectionView = {
      kind, state: completion?.state ?? (pool?.state === "SETTLED" || pool?.state === "LEGACY_PROTECTED" ? "LEGACY_PROTECTED" : "DRAFT"),
      ratePercent: financeView ? (displayCompletion?.ratePercentSnapshot ?? config?.ratePercent)?.toString() ?? null : null,
      price: financeView ? (displayCompletion?.priceSnapshot ?? product.expectedPrice)?.toString() ?? null : null,
      productCurrency: displayCompletion?.productCurrency ?? product.project.currency,
      payrollCurrency: displayCompletion?.payrollCurrency ?? null,
      total: financeView ? displayCompletion?.amount?.toString() ?? draftTotal : null,
      members: financeView ? members : ownMember ? [ownMember] : [], revision: config?.revision ?? 0,
      canManage: manager && (!completion || completion.state === "SKIPPED_ONCE"),
      canTransfer: !completion && !!ownMember,
      ownMember, legacyPaidSummary,
      skippedSnapshot: editableAfterSkip && financeView ? { completedAt: completion.completedAt.toISOString(), reason: completion.reason,
        price: completion.priceSnapshot?.toString() ?? null, ratePercent: completion.ratePercentSnapshot?.toString() ?? null,
        productCurrency: completion.productCurrency,
        members: completion.shares.map((row) => ({ userId: row.userId, name: row.userNameSnapshot, shareUnits: row.shareUnits })) } : null,
      requiresManagerReview: kind === "ENGINEERING" ? !!pool && pool.state === "DRAFT" && !config
        : !config && product.works.some((work) => work.paymentKind === "LEGACY"),
      installationWorkCandidates: kind === "INSTALLATION" && manager && (!completion || editableAfterSkip) ? product.works
        .filter((work) => work.paymentKind === "LEGACY")
        .map((work) => { const hasPaid = paid.some((entry) => entry.workId === work.id || work.tasks.some((task) => task.id === entry.taskId));
          const mismatched = work.projectId !== product.projectId || work.tasks.some((task) => task.projectId !== product.projectId || task.productId !== product.id);
          return { id: work.id, title: work.title, canConvert: !editableAfterSkip && !hasPaid && !mismatched && work.stagePayPoolId === null && work.poolWeightUnits === null,
            reason: editableAfterSkip ? "После пропуска этапа источник оплаты этой работы не меняется"
              : hasPaid ? "Уже есть начисление" : mismatched ? "Связь задачи и изделия не совпадает"
              : work.stagePayPoolId !== null || work.poolWeightUnits !== null ? "Связана со старым фондом" : null }; }) : [],
      classifiedInstallationWorkIds: kind === "INSTALLATION" && manager ? product.works
        .filter((work) => work.paymentKind === "INSTALLATION").map((work) => work.id) : [],
      transferCandidates: !completion && (manager || !!ownMember) ? (kind === "ENGINEERING" ? engineers : mounters)
        .filter((user) => user.id !== actor.id)
        .map((user) => ({ userId: user.id, name: user.name })) : [],
    };
    return [kind, view];
  })) as ProductPercentageView["sections"];
  return { productId, noModel: product.noModel, hasB3d: product.files.length > 0, sections };
}
