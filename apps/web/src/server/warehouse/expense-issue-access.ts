import type { Prisma } from "@prisma/client";
import { canAssignExpenseProject } from "@/lib/expense-project-assignment";
import { liveProductWhere } from "@/server/access/live-entities";
import { productDraftVisibilityWhere } from "@/server/access/visibility";
import type { DomainActor } from "@/server/actor";

export function requireExpenseIssueRole(actor: Pick<DomainActor, "roles">) {
  if (!canAssignExpenseProject(actor.roles)) throw Error("Недостаточно прав");
}

// Узкая выборка контекста для выдачи сохраняет существующие ограничения на черновики.
export function expenseIssueProductWhere(actor: Pick<DomainActor, "id" | "roles">, projectId?: string): Prisma.ProductWhereInput {
  return { AND: [liveProductWhere, productDraftVisibilityWhere(actor), projectId ? { projectId } : {}] };
}
