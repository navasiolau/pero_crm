export type EngineeringSplitBudget = {
  workAmount: string;
  currency: string;
  tasks: { id: string; stageShareUnits: number; createdAt: string }[];
};
export type EngineeringSplitPreview = {
  percent: string;
  remainingUnits: number;
  transferredUnits: number;
  remainingStageUnits: number;
  transferredStageUnits: number;
  remainingAmount: string | null;
  transferredAmount: string | null;
};
export function previewStageSplit(taskId: string, physicalUnits: number, stageUnits: number, percent: string, budget: EngineeringSplitBudget | null): EngineeringSplitPreview {
  const physical = splitAllocation(physicalUnits, "0.00", percent);
  const vectors = splitStageShareVectors({ quantityShareUnits: BigInt(physicalUnits), stageShareUnits: BigInt(stageUnits), percent: physical.percent });
  const result: EngineeringSplitPreview = {
    percent: physical.percent,
    remainingUnits: Number(vectors.remainingQuantityShareUnits), transferredUnits: Number(vectors.transferredQuantityShareUnits),
    remainingStageUnits: Number(vectors.remainingStageShareUnits), transferredStageUnits: Number(vectors.transferredStageShareUnits),
    remainingAmount: null, transferredAmount: null,
  };
  if (!budget) return result;
  if (budget.tasks.find((task) => task.id === taskId)?.stageShareUnits !== stageUnits)
    throw new Error("Финансовая доля изменилась. Обновите данные задачи");
  let childId = "__new_stage_preview__";
  while (budget.tasks.some((task) => task.id === childId)) childId += "_";
  const latest = Math.max(...budget.tasks.map((task) => new Date(task.createdAt).getTime()));
  if (!Number.isFinite(latest)) throw new Error("Не удалось проверить порядок задач для расчёта");
  // В предварительном распределении новая часть идёт после существующих.
  // Окончательные createdAt/id фиксируются сервером при создании и начислении.
  const rows = budget.tasks.map((task) => ({ id: task.id, createdAt: task.createdAt,
    units: BigInt(task.id === taskId ? result.remainingStageUnits : task.stageShareUnits) }));
  rows.push({ id: childId, createdAt: new Date(latest + 1).toISOString(), units: BigInt(result.transferredStageUnits) });
  const amounts = new Map(allocateStageMinorUnits(moneyAtoms(budget.workAmount), rows).map((row) => [row.id, row.amountMinor]));
  result.remainingAmount = amountFromAtoms(amounts.get(taskId)!);
  result.transferredAmount = amountFromAtoms(amounts.get(childId)!);
  return result;
}
import { allocateStageMinorUnits, splitStageShareVectors } from "./product-stage-pay";
import { moneyAtoms, quantityFromAtoms as amountFromAtoms, splitAllocation } from "./work-shares";
