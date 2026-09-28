import type { Prisma, ProductStatus, Role } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";

export type VisibilityActor = { id: string; roles: Role[] };

/** Full read rights come from these roles, even when ENGINEER is also present. */
export function hasFullProjectVisibility(actor: VisibilityActor): boolean {
  return hasAnyRole(actor.roles, MANAGER_ROLES) || hasRole(actor.roles, "ACCOUNTANT");
}

// Read grants from ACCOUNTANT/FIELD must never widen engineering edit rights.
export function productEditWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  return hasRole(actor.roles, "ENGINEER")
    ? { engineerId: actor.id, status: "DESIGN" }
    : { id: { in: [] } };
}

export function canEditProductTechnicalBlock(actor: VisibilityActor, product: { engineerId: string | null; status: ProductStatus }): boolean {
  return hasAnyRole(actor.roles, MANAGER_ROLES) || (
    hasRole(actor.roles, "ENGINEER") && product.engineerId === actor.id && product.status === "DESIGN"
  );
}

export function productVisibilityWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProductWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ engineerId: actor.id, status: "DESIGN" });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ project: { tasks: { some: { assigneeId: actor.id } } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function projectVisibilityWhere(actor: VisibilityActor): Prisma.ProjectWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProjectWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ products: { some: { engineerId: actor.id, status: "DESIGN" } } });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ tasks: { some: { assigneeId: actor.id } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function taskVisibilityWhere(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.TaskWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ product: { engineerId: actor.id, status: "DESIGN" } });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ project: { tasks: { some: { assigneeId: actor.id } } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

/** Execution is an assignee/manager grant, not a consequence of read access. */
export function taskExecutionWhere(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  if (hasAnyRole(actor.roles, FIELD_ROLES)) return { assigneeId: actor.id };
  if (hasRole(actor.roles, "ENGINEER")) return {
    assigneeId: actor.id, product: { engineerId: actor.id, status: "DESIGN" },
  };
  // Preserve the pre-existing assignee grant for an accountant without ENGINEER.
  if (hasRole(actor.roles, "ACCOUNTANT")) return { assigneeId: actor.id };
  return { id: { in: [] } };
}

export function workVisibilityWhere(actor: VisibilityActor): Prisma.WorkWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.WorkWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ product: { engineerId: actor.id, status: "DESIGN" } });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ project: { tasks: { some: { assigneeId: actor.id } } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function fileVisibilityWhere(actor: VisibilityActor): Prisma.FileWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  return {
    AND: [
      { project: projectVisibilityWhere(actor) },
      { OR: [{ productId: null }, { product: productVisibilityWhere(actor) }] },
      { OR: [{ taskId: null }, { task: taskVisibilityWhere(actor) }] },
    ],
  };
}

export function clientVisibilityWhere(actor: VisibilityActor): Prisma.ClientWhereInput {
  return hasFullProjectVisibility(actor) ? {} : { projects: { some: projectVisibilityWhere(actor) } };
}
