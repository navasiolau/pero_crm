import type { ProductStatus, ProjectStage } from "@prisma/client";

export function isPreContractProjectStage(stage: ProjectStage): boolean {
  return stage === "LEAD" || stage === "ESTIMATE";
}

/** Неизвестный контекст черновика в старой форме не разрешает обход договора. */
export function isProductDraftLocked(status: ProductStatus, stage?: ProjectStage | null): boolean {
  return status === "DRAFT" && (!stage || isPreContractProjectStage(stage));
}