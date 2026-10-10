import type { ProductStatus, Role } from "@prisma/client";

/** Производственный grant: назначения и дополнительные роли не расширяют статусы. */
export function fieldProductStatuses(roles: readonly Role[]): ProductStatus[] {
  const statuses: ProductStatus[] = [];
  if (roles.includes("WORKER")) statuses.push("PRODUCTION", "STORAGE");
  if (roles.includes("MOUNTER")) statuses.push("INSTALLATION");
  return statuses;
}
