import { Prisma, type PrismaClient, type ProductPercentageKind, type ProductStatus } from "@prisma/client";
import { allocatePercentageShares, type PercentageShare } from "@/lib/product-percentage-pay";
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
import { PERCENTAGE_STAGE_POLICY } from "./stage-policy";
import { captureDirectPercentage, settleSkippedPercentage, type PercentageAccrualEffects } from "./direct-completion";
import { isPermanentUnassignedCompletion } from "./skip-reason";

type Tx = Prisma.TransactionClient;
type ConfigureInput = { productId: string; kind: ProductPercentageKind; ratePercent: string | null;
  participants?: PercentageShare[]; expectedRevision: number; installationWorkIds?: string[]; reviewedLegacyWorks?: boolean };
type TransferInput = { productId: string; kind: ProductPercentageKind; toUserId: string;
  percentOfOwnShare: string; expectedRevision: number };

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
  if (!Object.hasOwn(PERCENTAGE_STAGE_POLICY,kind)) throw new Error("Неизвестный процентный этап");
}
function assertManager(actor: DomainActor): void {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
}
export async function configureProductPercentageCore(actor: DomainActor, input: ConfigureInput, tx: Tx) {
  void actor; void input; void tx;
  throw new Error("Сохраните одиночное поле оплаты через актуальную карточку изделия");
}
export async function transferProductPercentageCore(actor: DomainActor, input: TransferInput, tx: Tx) {
  void actor; void input; void tx;
  throw new Error("Передача процентных долей больше недоступна");
}

export async function setProductNoModelCore(actor: DomainActor, productId: string, noModel: boolean, tx: Tx) {
  void actor; void productId; void noModel; void tx;
  throw new Error("Отметка модели больше не используется для изменения статуса");
}
export async function captureProductPercentageCompletion(tx: Tx, actor: DomainActor, productId: string,
  kind: ProductPercentageKind, statusAtCompletion: ProductStatus, effects?: PercentageAccrualEffects,
  originalStatus?: ProductStatus) {
  assertKind(kind);
  const existing = await tx.productPercentageCompletion.findUnique({ where: { productId_kind: { productId, kind } }, select: { state: true, reason: true } });
  // Состоявшееся/защищённое не трогаем; пропущенное со ставкой добирается поздним переходом.
  if (existing && existing.state !== "SKIPPED_ONCE") return existing.state;
  if (existing && isPermanentUnassignedCompletion(existing)) return existing.state;
  if (existing) return settleSkippedPercentage(tx, actor, productId, kind, statusAtCompletion, effects);
  // Read the original status before the new transition, never its already-written target.
  const reached: ProductStatus[] = kind === "ENGINEERING" ? ["PRODUCTION", "STORAGE", "INSTALLATION", "DONE"]
    : kind === "ASSEMBLY" ? ["STORAGE", "INSTALLATION", "DONE"] : ["DONE"];
  const status = originalStatus ?? (await tx.product.findUnique({ where: { id: productId }, select: { status: true } }))?.status;
  if (status && reached.includes(status)) return "LEGACY_PROTECTED";
  if (await tx.productStatusHistory.findFirst({ where: { productId, OR: [
    { fromStatus: { in: reached } }, { toStatus: { in: reached } },
  ] }, select: { id: true } })) return "LEGACY_PROTECTED";
  return captureDirectPercentage(tx, actor, productId, kind, statusAtCompletion, effects);
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

export async function deliverAccrual(eventIds: string[], earnings: Earning[], productId: string, completedById: string | null): Promise<void> {
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
  if (pending.calculationVersion !== undefined && pending.calculationVersion !== 1) throw new Error("Новый процентный этап не допускает FX retry");
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
          scheme: PERCENTAGE_STAGE_POLICY[kind].scheme,
          month: current.completedAt.toISOString().slice(0, 7), comment: `${PERCENTAGE_STAGE_POLICY[kind].label} изделия ${pending.product.number}` } });
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

export async function deliverProductPercentageEffects(effects: PercentageAccrualEffects, productId: string, completedById: string) {
  if (effects.earnings.length) await deliverAccrual(effects.eventIds, effects.earnings, productId, completedById);
}
