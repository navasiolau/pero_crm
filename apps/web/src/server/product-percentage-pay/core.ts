import { INTERNAL_CURRENCY, assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { Prisma, type PrismaClient, type ProductPercentageKind, type ProductStatus } from "@prisma/client";
import { allocatePercentageShares, assertPercentageShares, parsePercentageRate, type PercentageShare } from "@/lib/product-percentage-pay";
import { calculateStageFund, type StageCurrency } from "@/lib/product-stage-pay";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import { isCurrency } from "@/server/finance/nbrb";
import { resolveStageRates } from "@/server/product-stage-pay/quote";
import { withTaskTransaction } from "@/server/tasks/transaction";
import type { TaskTransaction } from "@/server/tasks/transaction";
import type { DomainActor } from "@/server/projects/core";
import { prisma } from "@/lib/prisma";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { formatAmount } from "@/lib/format";

type Tx = Prisma.TransactionClient;
type ConfigureInput = { productId: string; kind: ProductPercentageKind; ratePercent: string | null;
  participants?: PercentageShare[]; expectedRevision: number; installationWorkIds?: string[]; reviewedLegacyWorks?: boolean };
type TransferInput = { productId: string; kind: ProductPercentageKind; toUserId: string;
  percentOfOwnShare: string; expectedRevision: number };
const requiredRole: Record<ProductPercentageKind, "ENGINEER" | "MOUNTER"> = { ENGINEERING: "ENGINEER", INSTALLATION: "MOUNTER" };

export async function assertPercentagePayrollCurrencyChange(tx: Pick<Tx, "productPercentageCompletion">, nextCurrency: string): Promise<void> {
  if (await tx.productPercentageCompletion.count({ where: { state: { in: ["PENDING_FX", "SETTLED"] },
    payrollCurrency: { not: nextCurrency } } }))
    throw new Error("Валюта зарплаты зафиксирована процентными начислениями изделия");
}

export async function assertPercentageProjectCurrencyChange(tx: Pick<Tx, "productPercentageCompletion">,
  projectId: string, nextCurrency: string): Promise<void> {
  if (await tx.productPercentageCompletion.count({ where: { product: { projectId },
    state: { in: ["PENDING_FX", "SETTLED"] }, productCurrency: { not: nextCurrency } } }))
    throw new Error("Валюта проекта зафиксирована процентным этапом изделия");
}

function assertKind(kind: ProductPercentageKind): void {
  if (kind !== "ENGINEERING" && kind !== "INSTALLATION") throw new Error("Неизвестный процентный этап");
}
function assertManager(actor: DomainActor): void {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
}
function assertRevision(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0 || actual !== expected)
    throw new Error("Настройки изменились. Обновите карточку изделия");
}
async function assertParticipants(tx: Tx, kind: ProductPercentageKind, rows: readonly PercentageShare[]): Promise<void> {
  assertPercentageShares(rows);
  const active = await tx.user.findMany({ where: { id: { in: rows.map((row) => row.userId) }, active: true,
    roles: { hasSome: [requiredRole[kind]] } }, select: { id: true } });
  if (active.length !== rows.length) throw new Error(kind === "ENGINEERING"
    ? "Укажите активных сотрудников с ролью инженера" : "Укажите активных сотрудников с ролью монтажника");
}

export async function configureProductPercentageCore(actor: DomainActor, input: ConfigureInput, tx: Tx) {
  assertManager(actor); assertKind(input.kind);
  const rate = parsePercentageRate(input.ratePercent);
  const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, projectId: true, engineerId: true } });
  if (!product) throw new Error("Изделие не найдено");
  const completion = await tx.productPercentageCompletion.findUnique({ where: { productId_kind: { productId: input.productId, kind: input.kind } }, select: { state: true } });
  if (completion && completion.state !== "SKIPPED_ONCE")
    throw new Error("Этап уже завершён; его снимок нельзя изменить");
  if (completion?.state === "SKIPPED_ONCE" && input.installationWorkIds?.length)
    throw new Error("После пропуска этапа нельзя переводить работы в монтажный процент без начисления");
  const old = await tx.productPercentageConfig.findUnique({ where: { productId_kind: { productId: input.productId, kind: input.kind } }, include: { participants: true } });
  assertRevision(old?.revision ?? 0, input.expectedRevision);
  const participants = old ? old.participants.map(({ userId, shareUnits }) => ({ userId, shareUnits }))
    : input.kind === "ENGINEERING" && product.engineerId ? [{ userId: product.engineerId, shareUnits: 1000000 }] : [];
  if (input.participants !== undefined) {
    const canonical = (rows: readonly PercentageShare[]) => JSON.stringify([...rows].map(({ userId, shareUnits }) => ({ userId, shareUnits })).sort((a,b) => a.userId.localeCompare(b.userId)));
    if (canonical(input.participants) !== canonical(participants)) throw new Error("Изменение распределения процентных долей больше недоступно");
  }
  if (!old && participants.length) await assertParticipants(tx, input.kind, participants);
  const legacyWorks = input.kind === "INSTALLATION" ? await tx.work.findMany({
    where: { productId: product.id, projectId: product.projectId, paymentKind: "LEGACY" }, select: { id: true },
  }) : [];
  const reviewedBefore = old?.reviewedLegacyWorkIds ?? [];
  if (!old && legacyWorks.length > 0 && input.reviewedLegacyWorks !== true)
    throw new Error("Подтвердите просмотр обычных работ: выбранные станут монтажными, остальные сохранят сдельную оплату");
  const reviewedLegacyWorkIds = input.reviewedLegacyWorks === true
    ? [...new Set([...reviewedBefore, ...legacyWorks.map((work) => work.id)])] : reviewedBefore;
  const workIds = input.installationWorkIds ?? [];
  if (workIds.length && input.kind !== "INSTALLATION") throw new Error("Монтажные работы указываются только для этапа монтажа");
  if (new Set(workIds).size !== workIds.length) throw new Error("Работы повторяются в списке");
  if (workIds.length) {
    const works = await tx.work.findMany({ where: { id: { in: workIds } }, include: { tasks: { select: { id: true, projectId: true, productId: true } } } });
    if (works.length !== workIds.length || works.some((work) => work.productId !== product.id || work.projectId !== product.projectId ||
      work.paymentKind !== "LEGACY" || work.stagePayPoolId !== null || work.poolWeightUnits !== null ||
      work.tasks.some((task) => task.projectId !== product.projectId || task.productId !== product.id)))
      throw new Error("Можно выбрать только обычные работы этого изделия, ещё не оплаченные другим способом");
    const taskIds = works.flatMap((work) => work.tasks.map((task) => task.id));
    const paid = await tx.payrollEntry.findFirst({ where: { OR: [{ workId: { in: workIds } }, { taskId: { in: taskIds } }] }, select: { id: true } });
    if (paid) throw new Error("У выбранной работы уже есть начисление; её историю менять нельзя");
    await tx.work.updateMany({ where: { id: { in: workIds } }, data: { paymentKind: "INSTALLATION" } });
  }
  const config = old ? await tx.productPercentageConfig.update({ where: { id: old.id }, data: {
      ratePercent: rate, revision: { increment: 1 }, reviewedLegacyWorkIds,
    } })
    : await tx.productPercentageConfig.create({ data: { productId: input.productId, kind: input.kind,
      ratePercent: rate, revision: 1, reviewedLegacyWorkIds } });
  if (!old && participants.length) await tx.productPercentageParticipant.createMany({ data: participants.map((row) => ({ configId: config.id, ...row })) });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: input.productId, action: "percentage.configure",
    oldValue: old ? { kind: old.kind, ratePercent: old.ratePercent?.toString() ?? null, revision: old.revision } : Prisma.JsonNull,
    newValue: { kind: input.kind, ratePercent: rate, revision: config.revision, participants,
      installationWorkIds: workIds, reviewedLegacyWorkIds, reviewedLegacyWorks: input.reviewedLegacyWorks === true } } });
  return { revision: config.revision };
}

export async function transferProductPercentageCore(actor: DomainActor, input: TransferInput, tx: Tx) {
  void actor; void input; void tx;
  throw new Error("Передача процентных долей больше недоступна");
}

export async function setProductNoModelCore(actor: DomainActor, productId: string, noModel: boolean, tx: Tx) {
  assertManager(actor);
  if (typeof noModel !== "boolean") throw new Error("Некорректная отметка модели");
  const product = await tx.product.findUnique({ where: { id: productId }, select: { noModel: true } });
  if (!product) throw new Error("Изделие не найдено");
  if (product.noModel === noModel) return;
  await tx.product.update({ where: { id: productId }, data: { noModel } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: productId, action: "noModel", oldValue: { noModel: product.noModel }, newValue: { noModel } } });
}

/** Вызывается только после status update в той же сериализованной транзакции. */
export async function captureProductPercentageCompletion(tx: Tx, actor: DomainActor, productId: string,
  kind: ProductPercentageKind, statusAtCompletion: ProductStatus) {
  assertKind(kind);
  const existing = await tx.productPercentageCompletion.findUnique({ where: { productId_kind: { productId, kind } }, select: { state: true } });
  if (existing) return existing.state;
  const product = await tx.product.findUnique({ where: { id: productId }, include: {
    project: { select: { currency: true } },
    percentageConfigs: { where: { kind }, include: { participants: { include: { user: { select: { id: true, name: true, active: true, roles: true } } } } } },
    stagePayPools: { where: { kind: "ENGINEERING" }, select: { state: true } },
  } });
  if (!product) throw new Error("Изделие не найдено");
  const config = product.percentageConfigs.at(0);
  const members = config?.participants ?? [];
  const legacyPaid = kind === "ENGINEERING" && product.stagePayPools.some((pool) => pool.state === "SETTLED" || pool.state === "LEGACY_PROTECTED");
  const validMembers = members.length > 0 && members.every((member) => member.user.active && member.user.roles.includes(requiredRole[kind]));
  const shares = members.map((member) => ({ userId: member.userId, shareUnits: member.shareUnits }));
  let completeShares = false;
  if (validMembers) { try { assertPercentageShares(shares); completeShares = true; } catch { /* сохранённая конфигурация требует решения менеджмента */ } }
  const payrollCurrency = INTERNAL_CURRENCY;
  const configured = !legacyPaid && product.expectedPrice !== null && config?.ratePercent !== null && config?.ratePercent !== undefined &&
    completeShares && isCurrency(product.project.currency) && isCurrency(payrollCurrency);
  if (configured) assertProjectMoneyCurrency(product.project.currency);
  const state = legacyPaid ? "LEGACY_PROTECTED" : configured ? "PENDING_FX" : "SKIPPED_ONCE";
  const reason = legacyPaid ? "Уже оплачен прежним способом" : configured ? null : "На момент завершения отсутствовала полная прямая настройка";
  const completion = await tx.productPercentageCompletion.create({ data: { productId, kind, state, statusAtCompletion,
    completedAt: new Date(), completedById: actor.id, reason, priceSnapshot: product.expectedPrice,
    ratePercentSnapshot: config?.ratePercent ?? null, productCurrency: product.project.currency,
    payrollCurrency, configRevision: config?.revision ?? null,
    shares: { create: members.map((member) => ({ userId: member.userId, userNameSnapshot: member.user.name,
      shareUnits: member.shareUnits })) } } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: productId, action: "percentage.firstCompletion",
    newValue: { kind, state, completionId: completion.id, statusAtCompletion } } });
  return state;
}

/** Курс читается вне транзакции; при ошибке PENDING_FX и статус уже сохранены. */
type SettlementState = "SETTLED" | "PENDING_FX" | "SKIPPED_ONCE" | "LEGACY_PROTECTED";
type Earning = { userId: string; userName: string; amount: string; currency: string };
type SettlementDependencies = {
  db?: Pick<PrismaClient, "productPercentageCompletion">;
  transaction?: TaskTransaction;
  resolveRates?: typeof resolveStageRates;
  deliver?: (eventIds: string[], earnings: Earning[], productId: string, completedById: string | null) => Promise<void>;
};

async function deliverAccrual(eventIds: string[], earnings: Earning[], productId: string, completedById: string | null): Promise<void> {
  for (const eventId of eventIds) await dispatchEvent(eventId).catch(() => {});
  for (const earning of earnings) {
    await notifyPerson({ userId: earning.userId, type: "payroll.accrued",
      title: `Начислена зарплата: ${formatAmount(earning.amount, earning.currency)}`,
      body: "Процент от стоимости изделия", link: "/payroll" }).catch(() => {});
    await notifyOrg({ type: "payroll.orgAccrued",
      title: `Начислено ${earning.userName}: ${formatAmount(earning.amount, earning.currency)}`,
      body: "Процент от стоимости изделия", link: "/finance/payroll", exceptUserId: completedById ?? undefined }).catch(() => {});
  }
  void productId;
}

export async function settlePendingProductPercentage(productId: string, kind: ProductPercentageKind,
  dependencies: SettlementDependencies = {}): Promise<SettlementState> {
  assertKind(kind);
  const db = dependencies.db ?? prisma;
  const transaction = dependencies.transaction ?? withTaskTransaction;
  const pending = await db.productPercentageCompletion.findUnique({ where: { productId_kind: { productId, kind } },
    include: { shares: true, product: { select: { number: true, projectId: true } } } });
  if (!pending) throw new Error("Завершение этапа не найдено");
  if (pending.state !== "PENDING_FX") return pending.state;
  if (pending.priceSnapshot === null || pending.ratePercentSnapshot === null || !pending.payrollCurrency ||
    !isCurrency(pending.productCurrency) || !isCurrency(pending.payrollCurrency)) throw new Error("Замороженный расчёт неполон");
  const rates = await (dependencies.resolveRates ?? resolveStageRates)(pending.productCurrency, pending.payrollCurrency, pending.completedAt);
  const result = await transaction(async (tx) => {
    const current = await tx.productPercentageCompletion.findUnique({ where: { id: pending.id }, include: { shares: true } });
    if (!current) throw new Error("Завершение этапа не найдено");
    if (current.state !== "PENDING_FX") return { state: current.state, newlySettled: false, eventIds: [] as string[], earnings: [] as Earning[], completedById: current.completedById };
    const fund = calculateStageFund({ price: current.priceSnapshot!.toString(), ratePercent: current.ratePercentSnapshot!.toString(),
      productCurrency: current.productCurrency as StageCurrency, payrollCurrency: current.payrollCurrency as StageCurrency,
      productRateByn: rates.product.rate, payrollRateByn: rates.payroll.rate });
    const rows = current.shares.map((row) => ({ userId: row.userId, shareUnits: row.shareUnits }));
    const amounts = allocatePercentageShares(fund.amount, rows);
    const byn = allocatePercentageShares(fund.bynAmount, rows);
    const project = allocatePercentageShares(fund.projectAmount, rows);
    const now = new Date();
    const eventIds: string[] = [];
    const earnings: Earning[] = [];
    for (const row of current.shares) {
      const amount = amounts.find((item) => item.userId === row.userId)!.amount;
      const bynAmount = byn.find((item) => item.userId === row.userId)!.amount;
      const projectAmount = project.find((item) => item.userId === row.userId)!.amount;
      await tx.productPercentageCompletionShare.update({ where: { id: row.id }, data: { amount, bynAmount, projectAmount } });
      if (amount !== "0.00") {
        await tx.payrollEntry.create({ data: { userId: row.userId, productId, projectId: pending.product.projectId,
          percentageCompletionShareId: row.id, amount, bynAmount, projectAmount,
          projectCurrency: current.productCurrency, currency: current.payrollCurrency!,
          scheme: kind === "ENGINEERING" ? "PRODUCT_PERCENT_ENGINEERING" : "PRODUCT_PERCENT_INSTALLATION",
          month: current.completedAt.toISOString().slice(0, 7), comment: `${kind === "ENGINEERING" ? "Проектирование" : "Монтаж"} изделия ${pending.product.number}` } });
        const event = await tx.domainEvent.create({ data: { type: "payroll.accrued", actor: current.completedById ?? undefined,
          payload: { userId: row.userId, productId, projectId: pending.product.projectId, kind, amount: Number(amount) } } });
        eventIds.push(event.id);
        earnings.push({ userId: row.userId, userName: row.userNameSnapshot, amount, currency: current.payrollCurrency! });
      }
    }
    await tx.productPercentageCompletion.update({ where: { id: current.id }, data: {
      state: "SETTLED", productRateByn: rates.product.rate, payrollRateByn: rates.payroll.rate,
      productRateDate: new Date(`${rates.product.date}T00:00:00.000Z`), payrollRateDate: new Date(`${rates.payroll.date}T00:00:00.000Z`),
      sourceFundExact: fund.sourceFundExact, amount: fund.amount, bynAmount: fund.bynAmount, projectAmount: fund.projectAmount, settledAt: now,
    } });
    return { state: "SETTLED" as const, newlySettled: true, eventIds, earnings, completedById: current.completedById };
  });
  if (result.newlySettled && result.earnings.length) await (dependencies.deliver ?? deliverAccrual)(
    result.eventIds, result.earnings, productId, result.completedById);
  return result.state;
}
