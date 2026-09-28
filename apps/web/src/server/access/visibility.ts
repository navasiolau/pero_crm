import type { Prisma, ProductStatus, Role } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";

export type VisibilityActor = { id: string; roles: Role[]; engineeringParticipantProductIds?: string[]; engineeringParticipantTaskIds?: string[] };

/** Participant membership comes from assignments, including zero-share tasks. */
export function engineeringProductWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  return {
    status: "DESIGN",
    OR: [
      ...(hasRole(actor.roles, "ENGINEER") ? [{ engineerId: actor.id }] : []),
      { id: { in: actor.engineeringParticipantProductIds ?? [] } },
    ],
  };
}

/** Use inside a mutation transaction for synchronous technical permission checks. */
export async function resolveVisibilityActor(
  db: Pick<Prisma.TransactionClient, "task">,
  actor: VisibilityActor,
): Promise<VisibilityActor> {
  const assignments = await engineeringAssignments(db, actor.id, true);
  return { ...actor, engineeringParticipantProductIds: [...new Set(assignments.map((task) => task.productId))], engineeringParticipantTaskIds: assignments.map((task) => task.id) };
}

export async function engineeringParticipantProductIds(
  db: Pick<Prisma.TransactionClient, "task">,
  userId: string,
  designOnly: boolean,
): Promise<string[]> {
  return [...new Set((await engineeringAssignments(db, userId, designOnly)).map((task) => task.productId))];
}

async function engineeringAssignments(
  db: Pick<Prisma.TransactionClient, "task">,
  userId: string,
  designOnly: boolean,
): Promise<{ id: string; productId: string }[]> {
  const assigned = await db.task.findMany({
    where: { assigneeId: userId, productId: { not: null }, work: { paymentKind: "ENGINEERING" }, ...(designOnly ? { product: { status: "DESIGN" } } : {}) },
    select: { id: true, productId: true, projectId: true, product: { select: { projectId: true } }, work: { select: { productId: true, projectId: true } } },
  });
  return assigned.flatMap((task) =>
    task.productId && task.product?.projectId === task.projectId && task.work?.projectId === task.projectId && task.work.productId === task.productId
      ? [{ id: task.id, productId: task.productId }] : []);
}

/** Full read rights come from these roles, even when ENGINEER is also present. */
export function hasFullProjectVisibility(actor: VisibilityActor): boolean {
  return hasAnyRole(actor.roles, MANAGER_ROLES) || hasRole(actor.roles, "ACCOUNTANT");
}

// Read grants from ACCOUNTANT/FIELD must never widen engineering edit rights.
export function productEditWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  return engineeringProductWhere(actor);
}

export function canEditProductTechnicalBlock(actor: VisibilityActor, product: { id?: string; engineerId: string | null; status: ProductStatus }): boolean {
  return hasAnyRole(actor.roles, MANAGER_ROLES) || (
    product.status === "DESIGN" && (
      (hasRole(actor.roles, "ENGINEER") && product.engineerId === actor.id) ||
      (!!product.id && !!actor.engineeringParticipantProductIds?.includes(product.id))
    )
  );
}

export function productVisibilityWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProductWhereInput[] = [];
  grants.push(engineeringProductWhere(actor));
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ project: { tasks: { some: { assigneeId: actor.id } } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function projectVisibilityWhere(actor: VisibilityActor): Prisma.ProjectWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProjectWhereInput[] = [];
  grants.push({ products: { some: engineeringProductWhere(actor) } });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ tasks: { some: { assigneeId: actor.id } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function taskVisibilityWhere(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.TaskWhereInput[] = [];
  grants.push({ product: engineeringProductWhere(actor) });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ project: { tasks: { some: { assigneeId: actor.id } } } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

/** Execution is an assignee/manager grant, not a consequence of read access. */
export function taskExecutionWhere(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  const grants: Prisma.TaskWhereInput[] = [
    { id: { in: actor.engineeringParticipantTaskIds ?? [] }, assigneeId: actor.id, product: { status: "DESIGN" } },
  ];
  // Сохраняем принятый порядок исполнения: чистый бухгалтер выполняет свои
  // задачи, а ENGINEER+ACCOUNTANT исполняет их через инженерный DESIGN-grant.
  if (hasAnyRole(actor.roles, FIELD_ROLES) || (hasRole(actor.roles, "ACCOUNTANT") && !hasRole(actor.roles, "ENGINEER"))) grants.push({ assigneeId: actor.id });
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ assigneeId: actor.id, product: { engineerId: actor.id, status: "DESIGN" } });
  return { OR: grants };
}

export function workVisibilityWhere(actor: VisibilityActor): Prisma.WorkWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.WorkWhereInput[] = [];
  grants.push({ product: engineeringProductWhere(actor) });
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
