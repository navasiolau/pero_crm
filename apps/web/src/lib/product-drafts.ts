import type { ProductStatus, ProjectStage, Role } from "@prisma/client";
import { ADMIN_ROLES, hasAnyRole } from "./roles";

export function isPreContractProjectStage(stage: ProjectStage): boolean {
  return stage === "LEAD" || stage === "ESTIMATE";
}

/** Неизвестный контекст черновика в старой форме не разрешает обход договора. */
export function isProductDraftLocked(status: ProductStatus, stage?: ProjectStage | null): boolean {
  return status === "DRAFT" && (!stage || isPreContractProjectStage(stage));
}
/** Глобальный доступ ко всем черновикам; КП не расширяет этот grant. */
export function canViewProductDrafts(roles: readonly Role[]): boolean {
  return hasAnyRole([...roles], ADMIN_ROLES);
}

type DraftLiveProject = { id: string; deletedAt?: Date | string | null };
/** Только контекст из серверного select; отсутствие любого live-поля запрещает доступ. */
export type ProductDraftAccessContext = {
  projectId?: string;
  deletedAt?: Date | string | null;
  project?: DraftLiveProject | null;
  proposalItem?: {
    deletedAt?: Date | string | null;
    proposal: {
      projectId: string | null;
      deletedAt?: Date | string | null;
      project?: DraftLiveProject | null;
    };
  } | null;
};

export function canAccessProductDraft(roles: readonly Role[], context?: ProductDraftAccessContext): boolean {
  if (canViewProductDrafts(roles)) return true;
  if (!roles.includes("MANAGER") || !context?.projectId || context.deletedAt !== null ||
    context.project?.id !== context.projectId || context.project.deletedAt !== null) return false;
  const item = context.proposalItem, proposal = item?.proposal;
  return item?.deletedAt === null && proposal?.deletedAt === null &&
    proposal.projectId === context.projectId && proposal.project?.id === context.projectId && proposal.project.deletedAt === null;
}
