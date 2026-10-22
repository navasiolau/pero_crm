import { createHash } from "node:crypto";
import type { DecimalInput } from "@/lib/work-shares";
import { workPlanRevision, type WorkPlan } from "@/server/works/plan";

/** Денежная команда дополнительно фиксирует расценку, которую общий план не включает. */
export function pieceworkPlanRevision(work: WorkPlan & { priceSnapshot: DecimalInput | null }): string {
  return createHash("sha256").update(JSON.stringify({ plan: workPlanRevision(work), rate: work.priceSnapshot?.toString() ?? null })).digest("hex");
}
