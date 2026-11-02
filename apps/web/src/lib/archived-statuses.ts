import { ProjectStage, ProductStatus } from "@prisma/client";
import { z } from "zod";

/** Только архивные факты и точные receipts; рабочие команды используют Prisma enum. */
export const archivedProjectStageSchema = z.enum([...Object.values(ProjectStage), "PAUSED", "RECLAMATION"]);
export const archivedProductStatusSchema = z.enum([...Object.values(ProductStatus), "RECLAMATION"]);
export type ArchivedProjectStage = z.infer<typeof archivedProjectStageSchema>;
export type ArchivedProductStatus = z.infer<typeof archivedProductStatusSchema>;
