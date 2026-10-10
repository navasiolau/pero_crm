import { createHash } from "node:crypto";
import type { DecimalInput } from "@/lib/work-shares";

export type WorkPlan = {
  id: string; projectId: string; productId: string | null; title: string;
  quantity: DecimalInput; quantityPerUnit: DecimalInput | null;
  priceItemId: string | null; unitSnapshot: string | null;
  paymentKind: string; stagePayPoolId: string | null; poolWeightUnits: number | null;
  tasks: { id: string; quantity: DecimalInput | null; allocationGroupId: string | null }[];
};

export function isOrdinaryWork(work: Pick<WorkPlan, "paymentKind" | "stagePayPoolId" | "poolWeightUnits">): boolean {
  return work.paymentKind === "LEGACY" && work.stagePayPoolId === null && work.poolWeightUnits === null;
}

// Ревизия включает весь занятый объём, но не раскрывает в hash денежные снимки.
export function workPlanRevision(work: WorkPlan): string {
  return createHash("sha256").update(JSON.stringify({
    id: work.id, projectId: work.projectId, productId: work.productId, title: work.title,
    quantity: work.quantity.toString(), quantityPerUnit: work.quantityPerUnit?.toString() ?? null,
    priceItemId: work.priceItemId, unitSnapshot: work.unitSnapshot,
    paymentKind: work.paymentKind, stagePayPoolId: work.stagePayPoolId, poolWeightUnits: work.poolWeightUnits,
    tasks: work.tasks.map(task => ({ id: task.id, quantity: task.quantity?.toString() ?? null,
      allocationGroupId: task.allocationGroupId })).sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex");
}
