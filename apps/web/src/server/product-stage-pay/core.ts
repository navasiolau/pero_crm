import { INTERNAL_CURRENCY, assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateStageFund, distributeStageFund, type StageCurrency } from "@/lib/product-stage-pay";
import { isCurrency } from "@/server/finance/nbrb";
import { MANAGER_ROLES, ROLE_PRIORITY, hasAnyRole } from "@/lib/roles";
import type { DomainActor } from "@/server/projects/core";
import { assertStageQuoteCurrent, resolveStageRates, type StageRateQuote } from "./quote";

type Tx = Prisma.TransactionClient;
type Reader = Pick<PrismaClient, "product" | "orgSetting">;
const FULL = 1_000_000;
function err(message: string): never { throw new Error(message); }
const numberText = (value: { toString(): string } | null | undefined) => value?.toString() ?? null;
const dateText = (value: Date | null | undefined) => value?.toISOString() ?? null;
const validUnits = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= FULL;
const assertManager = (actor: DomainActor) => {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) err("Недостаточно прав");
};
const assertRevision = (actual: number, expected: number) => {
  if (!Number.isSafeInteger(expected) || expected < 0 || actual !== expected)
    err("Данные инженерного фонда изменились. Обновите карточку и повторите действие");
};
const assertUuid = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) err("Неверный идентификатор запроса");
};
const assertDistribution = (actual: readonly { id: string }[], values: readonly { workId: string; units: number }[]) => {
  const ids = new Set(actual.map((row) => row.id));
  if (ids.size === 0 && values.length === 0) return;
  if (values.length !== ids.size || new Set(values.map((row) => row.workId)).size !== ids.size ||
    values.some((row) => !ids.has(row.workId) || !validUnits(row.units)) ||
    values.reduce((sum, row) => sum + row.units, 0) !== FULL)
    err("Веса всех инженерных работ должны составлять ровно 100 процентов");
};

async function auditEngineering(tx: Tx, actor: DomainActor, entity: string, entityId: string, action: string,
  oldValue: Prisma.InputJsonValue | undefined, newValue: Prisma.InputJsonValue) {
  return tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity, entityId, action, oldValue, newValue } });
}

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
  const existing = await tx.productStagePayPool.findUnique({ where: { productId_kind: { productId, kind: "ENGINEERING" } }, include: { works: true } });
  if (existing) return existing;
  return tx.productStagePayPool.create({ data: { productId, kind: "ENGINEERING", state: "DRAFT", createdById: actorId }, include: { works: true } });
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
  assertManager(actor);
  const context = await readContext(tx, input.productId);
  if (context.product.status !== "DESIGN") err("Инженерный фонд недоступен для настройки");
  if (!context.pool && input.expectedPoolRevision !== 0) err("Данные инженерного фонда изменились. Обновите карточку");
  if (context.pool?.state === "LEGACY_PROTECTED") err("Изделие защищено историческим начислением");
  if (context.pool?.state === "SETTLED") err("Инженерный фонд уже начислен");
  const pool = context.pool ?? await ensureNewEngineeringPool(tx, input.productId, actor.id);
  assertRevision(pool.revision, input.expectedPoolRevision);
  if (input.ratePercent !== null && (!/^\d{1,3}(?:\.\d{1,2})?$/.test(input.ratePercent) || Number(input.ratePercent) > 100)) err("Ставка должна быть от 0 до 100 процентов");
  assertDistribution(pool.works, input.workWeights);
  const before = { ratePercent: numberText(pool.ratePercent), workWeights: pool.works.map((work) => ({ workId: work.id, units: work.poolWeightUnits })) };
  for (const row of input.workWeights) await tx.work.update({ where: { id: row.workId }, data: { poolWeightUnits: row.units } });
  const updated = await tx.productStagePayPool.update({ where: { id: pool.id }, data: { ratePercent: input.ratePercent, revision: { increment: 1 } } });
  await auditEngineering(tx, actor, "productStagePayPool", pool.id, "engineering.configure", before,
    { ratePercent: input.ratePercent, workWeights: input.workWeights });
  return updated;
}

export async function configureEngineeringTaskShares(actor: DomainActor, input: {
  productId: string; workId: string; shares: { taskId: string; units: number; expectedRevision: number }[]; expectedPoolRevision: number;
}, tx: Tx) {
  assertManager(actor);
  const context = await readContext(tx, input.productId);
  const { product, pool } = context;
  if (!pool || pool.state !== "DRAFT" || product.status !== "DESIGN") err("Инженерный фонд недоступен для настройки долей");
  assertRevision(pool.revision, input.expectedPoolRevision);
  const work = pool.works.find((row) => row.id === input.workId);
  if (!work || work.paymentKind !== "ENGINEERING" || work.stagePayPoolId !== pool.id ||
    work.projectId !== product.projectId || work.productId !== product.id) err("Инженерная работа не принадлежит изделию");
  if (!work.tasks.length || work.tasks.some((task) => task.workId !== work.id || task.projectId !== product.projectId || task.productId !== product.id))
    err("Задачи инженерной работы имеют несогласованную привязку");
  const ids = new Set(work.tasks.map((task) => task.id));
  if (input.shares.length !== ids.size || new Set(input.shares.map((row) => row.taskId)).size !== ids.size ||
    input.shares.some((row) => !ids.has(row.taskId) || !validUnits(row.units)) ||
    input.shares.reduce((sum, row) => sum + row.units, 0) !== FULL)
    err("Укажите финансовые доли всех задач работы, всего 100 процентов");
  const targets = new Map(input.shares.map((row) => [row.taskId, row]));
  if (work.tasks.some((task) => targets.get(task.id)?.expectedRevision !== task.splitRevision))
    err("Данные задачи изменились. Обновите карточку и повторите действие");
  const paid = await tx.payrollEntry.count({ where: { OR: [{ workId: work.id }, { taskId: { in: work.tasks.map((task) => task.id) } }] } });
  if (paid) err("По работе или её задачам уже есть начисление");
  const changed = work.tasks.filter((task) => task.stageShareUnits !== targets.get(task.id)!.units);
  const before = { shares: work.tasks.map((task) => ({ taskId: task.id, units: task.stageShareUnits, revision: task.splitRevision })) };
  for (const task of changed) await tx.task.update({ where: { id: task.id }, data: { stageShareUnits: targets.get(task.id)!.units, splitRevision: { increment: 1 } } });
  if (changed.length) {
    await bumpEngineeringPoolRevision(tx, pool.id);
    await auditEngineering(tx, actor, "work", work.id, "engineering.shares", before,
      { shares: work.tasks.map((task) => ({ taskId: task.id, units: targets.get(task.id)!.units,
        revision: task.splitRevision + (changed.some((row) => row.id === task.id) ? 1 : 0) })) });
  }
  return { poolId: pool.id, revision: pool.revision + (changed.length ? 1 : 0), changedTaskIds: changed.map((task) => task.id) };
}

export async function createEngineeringWorkCore(actor: DomainActor, input: {
  productId: string; title: string; quantity: string; assigneeId: string; dueAt: Date; estimateMinutes: number;
  poolWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}, tx: Tx) {
  assertManager(actor);
  const context = await readContext(tx, input.productId);
  const { product, pool } = context;
  if (!pool || pool.state !== "DRAFT" || product.status !== "DESIGN") err("Инженерный фонд недоступен");
  assertRevision(pool.revision, input.expectedPoolRevision);
  if (!input.title.trim() || !/^\d{1,8}(?:\.\d{1,2})?$/.test(input.quantity) || Number(input.quantity) <= 0 ||
    !Number.isSafeInteger(input.estimateMinutes) || input.estimateMinutes <= 0 || !(input.dueAt instanceof Date) || !Number.isFinite(input.dueAt.getTime())) err("Заполните название, количество, срок и оценку задачи");
  const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { id: true, active: true, roles: true } });
  if (!assignee?.active || !assignee.roles?.length || !hasAnyRole(assignee.roles, ROLE_PRIORITY)) err("Выберите активного исполнителя с назначенной ролью");
  assertDistribution([...pool.works, { id: "__new__" }], input.poolWeights);
  const units = input.poolWeights.find((row) => row.workId === "__new__")?.units;
  if (units === undefined) err("Укажите вес новой работы");
  const work = await tx.work.create({ data: { projectId: product.projectId, productId: product.id, title: input.title.trim(), quantity: input.quantity,
    priceSnapshot: null, total: null, paymentKind: "ENGINEERING", stagePayPoolId: pool.id, poolWeightUnits: units, createdById: actor.id } });
  for (const row of input.poolWeights.filter((row) => row.workId !== "__new__")) await tx.work.update({ where: { id: row.workId }, data: { poolWeightUnits: row.units } });
  const group = await tx.taskAllocationGroup.create({ data: { workId: work.id, quantity: input.quantity, budget: null, budgetSource: "STAGE_PREVIEW", currency: null, createdById: actor.id } });
  const task = await tx.task.create({ data: { projectId: product.projectId, productId: product.id, workId: work.id, title: input.title.trim(),
    status: "NEW", type: "Проектирование", assigneeId: assignee.id, quantity: input.quantity, dueAt: input.dueAt, estimateMinutes: input.estimateMinutes,
    allocationGroupId: group.id, shareUnits: FULL, stageShareUnits: FULL, shareAmount: null, createdById: actor.id } });
  await bumpEngineeringPoolRevision(tx, pool.id);
  await auditEngineering(tx, actor, "work", work.id, "create",
    { workWeights: pool.works.map((member) => ({ workId: member.id, units: member.poolWeightUnits })) },
    { productId: product.id, projectId: product.projectId,
    title: input.title.trim(), quantity: input.quantity, poolId: pool.id, weightUnits: units,
    workWeights: input.poolWeights.map(({ workId, units }) => ({ workId: workId === "__new__" ? work.id : workId, units })) });
  await auditEngineering(tx, actor, "task", task.id, "create", undefined, { workId: work.id, productId: product.id,
    title: task.title, assigneeId: assignee.id, type: "Проектирование", stageShareUnits: FULL, quantity: input.quantity });
  const created = await tx.domainEvent.create({ data: { type: "task.created", actor: actor.id,
    payload: { taskId: task.id, workId: work.id, productId: product.id, projectId: product.projectId, assigneeId: assignee.id } } });
  const assigned = await tx.domainEvent.create({ data: { type: "task.assigned", actor: actor.id,
    payload: { taskId: task.id, projectId: product.projectId, assigneeId: assignee.id } } });
  return { workId: work.id, taskId: task.id, poolId: pool.id, taskTitle: task.title, assigneeId: assignee.id,
    projectId: product.projectId, projectNumber: product.project.number, eventIds: [created.id, assigned.id] };
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
  const pool = await tx.productStagePayPool.findUnique({ where: { id: input.poolId }, include: { product: true, works: true } });
  if (!pool || pool.kind !== "ENGINEERING" || pool.state !== "DRAFT" || pool.product.status !== "DESIGN") err("Инженерный фонд недоступен");
  assertRevision(pool.revision, input.expectedPoolRevision);
  const work = await tx.work.findUnique({ where: { id: input.workId }, include: { tasks: { include: { allocationGroup: true } }, allocationGroups: true } });
  if (!work || work.paymentKind !== "LEGACY" || work.productId !== pool.productId || work.projectId !== pool.product.projectId ||
    work.stagePayPoolId !== null || work.poolWeightUnits !== null) err("Работа должна принадлежать выбранному изделию и ещё не быть инженерной");
  if (!work.tasks.length || work.tasks.some((task) => task.productId !== work.productId || task.projectId !== work.projectId || task.workId !== work.id ||
    (task.allocationGroup && task.allocationGroup.workId !== work.id)) ||
    work.allocationGroups.some((group) => group.workId !== work.id)) err("Задачи или группы работы имеют несогласованную привязку");
  const oldPaid = await tx.payrollEntry.count({ where: { OR: [{ workId: work.id }, { taskId: { in: work.tasks.map((task) => task.id) } }] } });
  if (oldPaid) err("По работе или её задачам уже есть начисление");
  const shares = new Map(input.taskShares.map((row) => [row.taskId, row]));
  if (shares.size !== work.tasks.length || input.taskShares.length !== work.tasks.length ||
    work.tasks.some((task) => !shares.has(task.id) || shares.get(task.id)!.expectedRevision !== task.splitRevision) ||
    input.taskShares.some((row) => !validUnits(row.units)) || input.taskShares.reduce((sum, row) => sum + row.units, 0) !== FULL)
    err("Укажите актуальные финансовые доли всех задач, всего 100 процентов");
  assertDistribution([...pool.works, { id: work.id }], input.poolWeights);
  const sourceSnapshot = {
    version: 1, work: { id: work.id, projectId: work.projectId, productId: work.productId, quantity: numberText(work.quantity),
      priceSnapshot: numberText(work.priceSnapshot), total: numberText(work.total), paymentKind: work.paymentKind },
    tasks: work.tasks.map((task) => ({ id: task.id, quantity: numberText(task.quantity), assigneeId: task.assigneeId, status: task.status,
      shareUnits: task.shareUnits, shareAmount: numberText(task.shareAmount), allocationGroupId: task.allocationGroupId,
      splitRevision: task.splitRevision, executorShare: numberText(task.executorShare), doneAt: dateText(task.doneAt) })),
    groups: work.allocationGroups.map((group) => ({ id: group.id, quantity: numberText(group.quantity), budget: numberText(group.budget),
      currency: group.currency, budgetSource: group.budgetSource })),
  };
  const receipt = await tx.workPaymentConversion.create({ data: { workId: work.id, poolId: pool.id, requestId: input.requestId,
    requestFingerprint: fingerprintInput, convertedById: actor.id, convertedAt: new Date(),
    sourceSnapshot: sourceSnapshot as Prisma.InputJsonValue, targetShares: input.taskShares as Prisma.InputJsonValue } });
  await tx.work.update({ where: { id: work.id }, data: { paymentKind: "ENGINEERING", stagePayPoolId: pool.id,
    poolWeightUnits: input.poolWeights.find((row) => row.workId === work.id)!.units } });
  for (const row of input.poolWeights.filter((row) => row.workId !== work.id)) await tx.work.update({ where: { id: row.workId }, data: { poolWeightUnits: row.units } });
  for (const row of input.taskShares) await tx.task.update({ where: { id: row.taskId }, data: { stageShareUnits: row.units, splitRevision: { increment: 1 } } });
  await bumpEngineeringPoolRevision(tx, pool.id);
  return receipt;
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
  const context = await readContext(tx, input.productId);
  const { product, pool, payrollCurrency } = context;
  if (!pool || pool.kind !== "ENGINEERING" || pool.state !== "DRAFT" || product.status !== "DESIGN") err("Изделие должно быть в проектировании с незакрытым инженерным фондом");
  assertRevision(pool.revision, input.expectedPoolRevision);
  assertProjectMoneyCurrency(product.project.currency);
  if (!prepared || prepared.fingerprint !== fingerprint(context)) err("Данные инженерного фонда изменились. Обновите расчёт");
  assertStageQuoteCurrent(prepared.rates, product.project.currency, payrollCurrency, new Date());
  if (!product.engineerId || !product.engineer) err("Назначьте основного инженера изделия");
  if (product.expectedPrice === null || pool.ratePercent === null) err("Укажите цену изделия и ставку фонда");
  if (product.works.some((work) => work.paymentKind === "ENGINEERING" && (work.stagePayPoolId !== pool.id ||
    !pool.works.some((member) => member.id === work.id))) ||
    !pool.works.length || pool.works.some((work) => work.paymentKind !== "ENGINEERING" || work.stagePayPoolId !== pool.id ||
    work.projectId !== product.projectId || work.productId !== product.id || !validUnits(work.poolWeightUnits ?? -1) || !work.tasks.length ||
    work.tasks.some((task) => task.workId !== work.id || task.projectId !== product.projectId || task.productId !== product.id ||
      task.status !== "DONE" || !task.assigneeId || !task.assignee || !validUnits(task.stageShareUnits ?? -1) ||
      (task.allocationGroup && task.allocationGroup.workId !== work.id)) ||
    work.tasks.reduce((sum, task) => sum + (task.stageShareUnits ?? 0), 0) !== FULL) ||
    pool.works.reduce((sum, work) => sum + (work.poolWeightUnits ?? 0), 0) !== FULL)
    err("Завершите все инженерные задачи и распределите 100 процентов фонда и каждой работы");
  if (pool.legacyPayrollEntryIds.length || await tx.productStageSettlement.count({ where: { productId: product.id } })) err("Инженерный фонд уже оплачен или защищён историческим начислением");
  const paid = await tx.payrollEntry.count({ where: { OR: [
    { workId: { in: pool.works.map((work) => work.id) } },
    { taskId: { in: pool.works.flatMap((work) => work.tasks.map((task) => task.id)) } },
  ] } });
  if (paid) err("По инженерной работе или задаче уже есть начисление");
  const legacy = await tx.payrollEntry.count({ where: { productId: product.id, scheme: "PERCENT_PROJECT" } });
  if (legacy) err("По изделию уже есть историческое процентное начисление");
  const fund = calculateStageFund({ price: product.expectedPrice.toString(), ratePercent: pool.ratePercent.toString(),
    productCurrency: product.project.currency as StageCurrency, payrollCurrency,
    productRateByn: prepared.rates.product.rate, payrollRateByn: prepared.rates.payroll.rate });
  const distribution = distributeStageFund(fund, pool.works.map((work) => ({ id: work.id, poolWeightUnits: BigInt(work.poolWeightUnits!), createdAt: work.createdAt,
    tasks: work.tasks.map((task) => ({ id: task.id, userId: task.assigneeId!, stageShareUnits: BigInt(task.stageShareUnits!), createdAt: task.createdAt })) })));
  const eventIds: string[] = [];
  const earnings: { userId: string; name: string; amount: string; currency: string }[] = [];
  const closedAt = new Date();
  const settlement = await tx.productStageSettlement.create({ data: { poolId: pool.id, productId: product.id, projectId: product.projectId,
    closedById: actor.id, closedAt, poolRevision: pool.revision, primaryEngineerIdSnapshot: product.engineerId,
    primaryEngineerNameSnapshot: product.engineer.name, priceSnapshot: product.expectedPrice, ratePercentSnapshot: pool.ratePercent,
    productCurrency: product.project.currency, payrollCurrency, productRateByn: prepared.rates.product.rate, payrollRateByn: prepared.rates.payroll.rate,
    productRateDate: new Date(`${prepared.rates.product.date}T00:00:00.000Z`), payrollRateDate: new Date(`${prepared.rates.payroll.date}T00:00:00.000Z`),
    sourceFundExact: fund.sourceFundExact, amount: fund.amount, bynAmount: fund.bynAmount, projectAmount: fund.projectAmount } });
  for (const allocatedWork of distribution.works) {
    const work = pool.works.find((row) => row.id === allocatedWork.id)!;
    for (const allocation of allocatedWork.tasks) {
      const task = work.tasks.find((row) => row.id === allocation.id)!;
      const share = await tx.productStageSettlementShare.create({ data: { settlementId: settlement.id, taskId: task.id, workId: work.id,
        userId: task.assigneeId!, taskTitleSnapshot: task.title, workTitleSnapshot: work.title, userNameSnapshot: task.assignee!.name,
        workWeightUnits: work.poolWeightUnits!, stageShareUnits: task.stageShareUnits!, quantitySnapshot: task.quantity,
        quantityShareUnitsSnapshot: task.shareUnits ?? FULL, allocationGroupIdSnapshot: task.allocationGroupId,
        amount: allocation.amount, bynAmount: allocation.bynAmount, projectAmount: allocation.projectAmount } });
      if (allocation.amount !== "0.00") await tx.payrollEntry.create({ data: { userId: task.assigneeId!, taskId: task.id, workId: work.id,
        productId: product.id, projectId: product.projectId, settlementShareId: share.id, amount: allocation.amount,
        bynAmount: allocation.bynAmount, projectAmount: allocation.projectAmount, projectCurrency: product.project.currency,
        currency: payrollCurrency, scheme: "PRODUCT_ENGINEERING", month: closedAt.toISOString().slice(0, 7),
        comment: `Инженерный фонд изделия ${product.number}` } });
    }
  }
  for (const beneficiary of distribution.beneficiaries) if (beneficiary.amount !== "0.00") {
    const recipient = pool.works.flatMap((work) => work.tasks).find((task) => task.assigneeId === beneficiary.userId)!;
    earnings.push({ userId: beneficiary.userId, name: recipient.assignee!.name, amount: beneficiary.amount, currency: payrollCurrency });
    const payrollEvent = await tx.domainEvent.create({ data: { type: "payroll.accrued", actor: actor.id,
      payload: { userId: beneficiary.userId, projectId: product.projectId, productId: product.id,
        scheme: "PRODUCT_ENGINEERING", amount: Number(beneficiary.amount), month: closedAt.toISOString().slice(0, 7) } } });
    eventIds.push(payrollEvent.id);
  }
  await tx.productStagePayPool.update({ where: { id: pool.id }, data: { state: "SETTLED", revision: { increment: 1 } } });
  await tx.product.update({ where: { id: product.id }, data: { status: "PRODUCTION", statusChangedAt: closedAt } });
  await tx.productStatusHistory.create({ data: { productId: product.id, fromStatus: "DESIGN", toStatus: "PRODUCTION", changedById: actor.id } });
  await tx.changeLog.create({ data: { id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: product.id, action: "engineering.close", oldValue: { status: "DESIGN", poolRevision: pool.revision },
    newValue: { status: "PRODUCTION", expectedPoolRevision: input.expectedPoolRevision, settlementId: settlement.id, amount: fund.amount, currency: payrollCurrency } } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: product.id, action: "status", field: "status", oldValue: "DESIGN", newValue: "PRODUCTION" } });
  const statusEvent = await tx.domainEvent.create({ data: { type: "product.statusChanged", actor: actor.id,
    payload: { productId: product.id, number: product.number, from: "DESIGN", to: "PRODUCTION" } } });
  eventIds.push(statusEvent.id);
  const event = await tx.domainEvent.create({ data: { type: "product.engineeringSettled", actor: actor.id,
    payload: { productId: product.id, projectId: product.projectId, settlementId: settlement.id, amount: fund.amount, currency: payrollCurrency } } });
  eventIds.push(event.id);
  return { settlementId: settlement.id, repeated: false as const, eventId: event.id, eventIds, earnings,
    product: { id: product.id, number: product.number, title: product.title } };
}
