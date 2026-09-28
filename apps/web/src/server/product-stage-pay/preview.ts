import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateStageFund, distributeStageFund, type StageCurrency } from "@/lib/product-stage-pay";
import { resolveStageRates } from "./quote";

type Reader = Pick<PrismaClient, "product" | "orgSetting"> | Prisma.TransactionClient;
export type EngineeringTaskPreview = { amount: string; bynAmount: string; projectAmount: string; currency: string; settled: boolean };

/** Read-only preview. Rates are fetched outside transaction by callers; this function must not run under the task lock. */
export async function getEngineeringPreview(db: Reader, productId: string) {
  const product = await db.product.findUnique({ where: { id: productId }, include: {
    project: { select: { currency: true } },
    works: { select: { id: true, paymentKind: true, stagePayPoolId: true } },
    stagePayPools: { where: { kind: "ENGINEERING" }, include: {
      settlement: { include: { shares: true } },
      works: { include: { tasks: { select: { id: true, workId: true, projectId: true, productId: true,
        assigneeId: true, stageShareUnits: true, createdAt: true } } } },
    } },
  } });
  if (!product) throw new Error("Изделие не найдено");
  const pool = product.stagePayPools.at(0);
  if (!pool) return { state: "ABSENT" as const, ratePercent: null, amount: null, currency: null, tasks: new Map<string, EngineeringTaskPreview>() };
  if (pool.state === "LEGACY_PROTECTED") return { state: pool.state, ratePercent: null, amount: null, currency: null, tasks: new Map<string, EngineeringTaskPreview>() };
  if (pool.settlement) return { state: "SETTLED" as const, ratePercent: pool.settlement.ratePercentSnapshot.toString(),
    amount: pool.settlement.amount.toString(), currency: pool.settlement.payrollCurrency,
    tasks: new Map(pool.settlement.shares.map((share) => [share.taskId, { amount: share.amount.toString(), bynAmount: share.bynAmount.toString(),
      projectAmount: share.projectAmount.toString(), currency: pool.settlement!.payrollCurrency, settled: true }])) };
  const allWorks = pool.works;
  if (product.works.some((work) => work.paymentKind === "ENGINEERING" &&
    (work.stagePayPoolId !== pool.id || !allWorks.some((member) => member.id === work.id))) ||
    allWorks.some((work) => work.paymentKind !== "ENGINEERING" || work.stagePayPoolId !== pool.id ||
    work.productId !== product.id || work.projectId !== product.projectId || work.tasks.some((task) =>
      task.workId !== work.id || task.productId !== product.id || task.projectId !== product.projectId)))
    throw new Error("Инженерная работа или задача имеет несогласованную привязку к изделию");
  if (product.expectedPrice === null || pool.ratePercent === null || !allWorks.length ||
    allWorks.some((work) => work.poolWeightUnits === null || work.tasks.length === 0 || work.tasks.some((task) => task.stageShareUnits === null || !task.assigneeId) ||
      work.tasks.reduce((sum, task) => sum + (task.stageShareUnits ?? 0), 0) !== 1_000_000) ||
    allWorks.reduce((sum, work) => sum + (work.poolWeightUnits ?? 0), 0) !== 1_000_000)
    return { state: "DRAFT" as const, ratePercent: pool.ratePercent?.toString() ?? null, amount: null, currency: null, tasks: new Map<string, EngineeringTaskPreview>() };
  const setting = await db.orgSetting.findUnique({ where: { key: "payrollCurrency" } });
  const payrollCurrency = setting?.value ?? "BYN";
  const quote = await resolveStageRates(product.project.currency, payrollCurrency, new Date());
  const fund = calculateStageFund({ price: product.expectedPrice.toString(), ratePercent: pool.ratePercent.toString(),
    productCurrency: product.project.currency as StageCurrency, payrollCurrency: payrollCurrency as StageCurrency,
    productRateByn: quote.product.rate, payrollRateByn: quote.payroll.rate });
  const shares = distributeStageFund(fund, allWorks.map((work) => ({ id: work.id, poolWeightUnits: BigInt(work.poolWeightUnits!), createdAt: work.createdAt,
    tasks: work.tasks.map((task) => ({ id: task.id, userId: task.assigneeId!, stageShareUnits: BigInt(task.stageShareUnits!), createdAt: task.createdAt })) })));
  const tasks = new Map<string, EngineeringTaskPreview>(shares.works.flatMap((work) => work.tasks.map((task) => [task.id, { amount: task.amount,
    bynAmount: task.bynAmount, projectAmount: task.projectAmount, currency: payrollCurrency, settled: false }] as const)));
  return { state: "DRAFT" as const, ratePercent: pool.ratePercent.toString(), amount: fund.amount, currency: payrollCurrency, tasks };
}

export async function getEngineeringTaskPreview(db: Pick<PrismaClient, "product" | "orgSetting">, productId: string): Promise<Map<string, EngineeringTaskPreview>> {
  return (await getEngineeringPreview(db, productId)).tasks;
}
