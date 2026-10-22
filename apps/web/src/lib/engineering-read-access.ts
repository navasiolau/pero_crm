import type { ProductStatus, ProjectStage } from "@prisma/client";

/** Чтение не зависит от назначения и не даёт права технической правки. */
export const ENGINEER_PROJECT_STAGES = ["CONTRACT", "IN_WORK", "DONE"] as const satisfies readonly ProjectStage[];
export const ENGINEER_PRODUCT_STATUSES = ["DESIGN", "PRODUCTION", "STORAGE", "INSTALLATION", "DONE"] as const satisfies readonly ProductStatus[];
