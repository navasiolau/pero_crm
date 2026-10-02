import { INTERNAL_CURRENCY, assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { type StageCurrency } from "@/lib/product-stage-pay";
import { isCurrency } from "@/server/finance/nbrb";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor } from "@/server/projects/core";
import { resolveStageRates, type StageRateQuote } from "./quote";

type Tx = Prisma.TransactionClient;
type Reader = Pick<PrismaClient, "product" | "orgSetting">;
function err(message: string): never { throw new Error(message); }
const numberText = (value: { toString(): string } | null | undefined) => value?.toString() ?? null;
const dateText = (value: Date | null | undefined) => value?.toISOString() ?? null;
const assertManager = (actor: DomainActor) => {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) err("Недостаточно прав");
};
const assertUuid = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) err("Неверный идентификатор запроса");
};
const includeEngineering = {
  project: { select: { id: true, number: true, currency: true } },
  engineer: { select: { id: true, name: true } },
  works: { select: { id: true, projectId: true, productId: true, paymentKind: true, stagePayPoolId: true } },
  stagePayPools: {
    where: { kind: "ENGINEERING" as const },
    include: { works: { include: { tasks: { include: { assignee: { select: { id: true, name: true } }, allocationGroup: { select: { id: true, workId: true, quantity: true } } } } } } },
  },
} satisfies Prisma.ProductInclude;

async function readContext(db: Reader | Tx, productId: string) {
  const product = await db.product.findUnique({ where: { id: productId }, include: includeEngineering });
  if (!product) err("Изделие не найдено");
  const payrollCurrency = INTERNAL_CURRENCY;
  if (!isCurrency(product.project.currency) || !isCurrency(payrollCurrency)) err("Валюта расчёта не поддерживается");
  return { product, pool: product.stagePayPools.at(0) ?? null, payrollCurrency: payrollCurrency as StageCurrency };
}

function fingerprint(context: Awaited<ReturnType<typeof readContext>>): string {
  const { product, pool, payrollCurrency } = context;
  const state = {
    product: { id: product.id, projectId: product.projectId, status: product.status, price: numberText(product.expectedPrice), engineerId: product.engineerId, engineerName: product.engineer?.name ?? null },
    currencies: [product.project.currency, payrollCurrency],
    pool: pool && { id: pool.id, kind: pool.kind, state: pool.state, rate: numberText(pool.ratePercent), revision: pool.revision, legacy: pool.legacyPayrollEntryIds },
    membership: product.works.filter((work) => work.paymentKind === "ENGINEERING").map((work) => ({ id: work.id, projectId: work.projectId,
      productId: work.productId, poolId: work.stagePayPoolId })).sort((a, b) => a.id.localeCompare(b.id)),
    works: (pool?.works ?? []).map((work) => ({ id: work.id, projectId: work.projectId, productId: work.productId, paymentKind: work.paymentKind,
      poolId: work.stagePayPoolId, units: work.poolWeightUnits, createdAt: dateText(work.createdAt),
      tasks: work.tasks.map((task) => ({ id: task.id, workId: task.workId, projectId: task.projectId, productId: task.productId,
        status: task.status, assigneeId: task.assigneeId, assigneeName: task.assignee?.name ?? null, units: task.stageShareUnits,
        revision: task.splitRevision, quantity: numberText(task.quantity), physicalUnits: task.shareUnits, groupId: task.allocationGroupId,
        groupWorkId: task.allocationGroup?.workId ?? null, groupQuantity: numberText(task.allocationGroup?.quantity), createdAt: dateText(task.createdAt), title: task.title }))
        .sort((a, b) => a.id.localeCompare(b.id)), title: work.title })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export interface PreparedEngineeringQuote { rates: StageRateQuote; fingerprint: string }
/** Call before entering withTaskTransaction. The caller must not accept rates from the browser. */
export async function prepareEngineeringQuote(productId: string, db: Reader, now = new Date()): Promise<PreparedEngineeringQuote> {
  const context = await readContext(db, productId);
  assertProjectMoneyCurrency(context.product.project.currency);
  return { rates: await resolveStageRates(context.product.project.currency, context.payrollCurrency, now), fingerprint: fingerprint(context) };
}

export async function ensureNewEngineeringPool(tx: Tx, productId: string, actorId: string) {
  void productId; void actorId; void tx;
  err("Новые инженерные фонды закрыты; используйте одиночную оплату изделия");
}

export async function assertEngineeringPoolWritable(tx: Tx, productId: string) {
  const context = await readContext(tx, productId);
  if (!context.pool || context.pool.kind !== "ENGINEERING" || context.pool.state !== "DRAFT" || context.product.status !== "DESIGN")
    err("Инженерный фонд можно менять только на этапе проектирования до начисления");
  return context.pool;
}

export async function bumpEngineeringPoolRevision(tx: Tx, poolId: string): Promise<void> {
  const pool = await tx.productStagePayPool.findUnique({ where: { id: poolId }, select: { id: true, productId: true, kind: true, state: true } });
  if (!pool || pool.kind !== "ENGINEERING" || pool.state !== "DRAFT") err("Инженерный фонд уже закрыт");
  const product = await tx.product.findUnique({ where: { id: pool.productId }, select: { status: true } });
  if (product?.status !== "DESIGN") err("Изделие уже вышло из проектирования");
  await tx.productStagePayPool.update({ where: { id: poolId }, data: { revision: { increment: 1 } } });
}

export async function assertEngineeringTransition(tx: Tx, productId: string, toStatus: string): Promise<void> {
  if (!["PRODUCTION", "DELIVERY", "INSTALLATION", "DONE"].includes(toStatus)) return;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { status: true, stagePayPools: { where: { kind: "ENGINEERING" }, select: { state: true } } } });
  if (!product) err("Изделие не найдено");
  if (product.stagePayPools[0]?.state === "DRAFT") err("Сначала подтвердите передачу инженерного фонда в производство");
}

export async function assertProjectCurrencyChange(tx: Tx, projectId: string, nextCurrency: string): Promise<void> {
  const current = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
  if (!current) err("Проект не найден");
  if (current.currency === nextCurrency) return;
  if (await tx.productStageSettlement.count({ where: { projectId } })) err("Валюта проекта зафиксирована инженерным начислением");
}

export async function assertPayrollCurrencyChange(tx: Tx, nextCurrency: string): Promise<void> {
  const current = await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } });
  if ((current?.value ?? "BYN") === nextCurrency) return;
  if (await tx.productStageSettlement.count()) err("Валюта зарплаты зафиксирована инженерными начислениями");
}

export async function configureEngineeringPool(actor: DomainActor, input: {
  productId: string; ratePercent: string | null; workWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}, tx: Tx) {
  assertManager(actor); void input; void tx;
  err("Новые инженерные фонды закрыты; используйте одиночную оплату изделия");
}

export async function configureEngineeringTaskShares(actor: DomainActor, input: {
  productId: string; workId: string; shares: { taskId: string; units: number; expectedRevision: number }[]; expectedPoolRevision: number;
}, tx: Tx) {
  assertManager(actor); void input; void tx;
  err("Новые инженерные фонды закрыты; используйте одиночную оплату изделия");
}

export async function createEngineeringWorkCore(actor: DomainActor, input: {
  productId: string; title: string; quantity: string; assigneeId: string; dueAt: Date; estimateMinutes: number;
  poolWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}, tx: Tx) {
  assertManager(actor); void input; void tx;
  err("Новые инженерные фонды закрыты; используйте одиночную оплату изделия");
}

export async function convertUnpaidWorkToEngineering(actor: DomainActor, input: {
  workId: string; poolId: string; poolWeights: { workId: string; units: number }[];
  taskShares: { taskId: string; units: number; expectedRevision: number }[];
  expectedPoolRevision: number; requestId: string;
}, tx: Tx) {
  assertManager(actor); assertUuid(input.requestId);
  if (!Array.isArray(input.poolWeights) || !Array.isArray(input.taskShares)) err("Укажите полное распределение работ и задач");
  const fingerprintInput = createHash("sha256").update(JSON.stringify({
    workId: input.workId, poolId: input.poolId, expectedPoolRevision: input.expectedPoolRevision,
    poolWeights: input.poolWeights.map(({ workId, units }) => ({ workId, units })).sort((a, b) => a.workId.localeCompare(b.workId)),
    taskShares: input.taskShares.map(({ taskId, units, expectedRevision }) => ({ taskId, units, expectedRevision })).sort((a, b) => a.taskId.localeCompare(b.taskId)),
  })).digest("hex");
  const repeated = await tx.workPaymentConversion.findUnique({ where: { requestId: input.requestId } });
  if (repeated) {
    if (repeated.convertedById !== actor.id || repeated.requestFingerprint !== fingerprintInput) err("Идентификатор запроса уже использован");
    return repeated;
  }
  err("Конвертация в старый инженерный фонд закрыта");
}

export async function closeEngineeringStageCore(actor: DomainActor, input: {
  productId: string; expectedPoolRevision: number; requestId: string;
}, prepared: PreparedEngineeringQuote | null, tx: Tx) {
  assertManager(actor); assertUuid(input.requestId);
  const receiptId = `product-engineering-close:${input.requestId}`;
  const receipt = await tx.changeLog.findUnique({ where: { id: receiptId } });
  if (receipt) {
    const saved = receipt.newValue;
    if (receipt.actorId !== actor.id || receipt.entity !== "product" || receipt.entityId !== input.productId || receipt.action !== "engineering.close" ||
      !saved || typeof saved !== "object" || Array.isArray(saved) ||
      saved.expectedPoolRevision !== input.expectedPoolRevision || typeof saved.settlementId !== "string") err("Идентификатор запроса уже использован");
    return { settlementId: saved.settlementId as string, repeated: true as const, eventId: null, eventIds: [] as string[],
      earnings: [] as { userId: string; name: string; amount: string; currency: string }[], product: null };
  }
  void prepared;
  err("Новое закрытие старого инженерного фонда запрещено");
}
