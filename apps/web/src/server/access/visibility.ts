import type { Prisma, ProductStatus, Role } from "@prisma/client";
import { ASSIGNEE_ROLES,FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";

export type VisibilityActor = { id: string; roles: Role[]; engineeringParticipantProductIds?: string[];
  engineeringParticipantTaskIds?: string[]; fieldParticipantProductIds?: string[] };

/** Participant membership comes from assignments, including zero-share tasks. */
export function engineeringProductWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (!hasRole(actor.roles, "ENGINEER")) return { id: { in: [] } };
  return {
    status: "DESIGN",
    OR: [
      { engineerId: actor.id },
      { id: { in: actor.engineeringParticipantProductIds ?? [] } },
    ],
  };
}

/** Current assignment grants status-return reading, never production technical edits. */
export function currentEngineeringReadWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (!hasRole(actor.roles, "ENGINEER")) return { id: { in: [] } };
  return { engineerId: actor.id, status: { in: ["DESIGN", "PRODUCTION"] } };
}

/** Use inside a mutation transaction for synchronous technical permission checks. */
export async function resolveVisibilityActor(
  db: Pick<Prisma.TransactionClient, "task"> & Partial<Pick<Prisma.TransactionClient, "productPercentageParticipant">>,
  actor: VisibilityActor,
): Promise<VisibilityActor> {
  const assignments = hasAnyRole(actor.roles,ASSIGNEE_ROLES) ? await engineeringAssignments(db, actor.id, true) : [];
  const direct = hasRole(actor.roles, "ENGINEER") && db.productPercentageParticipant ? await db.productPercentageParticipant.findMany({
    where: { userId: actor.id, config: { kind: "ENGINEERING", product: { status: "DESIGN" } } },
    select: { config: { select: { productId: true } } },
  }) : [];
  const field = hasAnyRole(actor.roles, FIELD_ROLES) && db.productPercentageParticipant ? await db.productPercentageParticipant.findMany({
    where: { userId: actor.id, config: { kind: "INSTALLATION", product: { status: { not: "DESIGN" } } } },
    select: { config: { select: { productId: true } } },
  }) : [];
  return { ...actor, engineeringParticipantProductIds: [...new Set([
    ...assignments.map((task) => task.productId), ...direct.map((row) => row.config.productId),
  ])], engineeringParticipantTaskIds: assignments.map((task) => task.id),
    fieldParticipantProductIds: field.map((row) => row.config.productId) };
}

export async function engineeringParticipantProductIds(
  db: Pick<Prisma.TransactionClient, "task"> & Partial<Pick<Prisma.TransactionClient, "productPercentageParticipant">>,
  userId: string,
  designOnly: boolean,
): Promise<string[]> {
  const [legacy, direct] = await Promise.all([
    engineeringAssignments(db, userId, designOnly),
    db.productPercentageParticipant?.findMany({ where: { userId, config: { kind: "ENGINEERING",
      ...(designOnly ? { product: { status: "DESIGN" } } : {}) } }, select: { config: { select: { productId: true } } } }),
  ]);
  return [...new Set([...legacy.map((task) => task.productId), ...(direct ?? []).map((row) => row.config.productId)])];
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
  return hasAnyRole(actor.roles, MANAGER_ROLES) || hasRole(actor.roles, "PROCUREMENT");
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
      (hasRole(actor.roles, "ENGINEER") && !!product.id && !!actor.engineeringParticipantProductIds?.includes(product.id))
    )
  );
}

export function assignedProductVisibilityWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProductWhereInput[] = [];
  grants.push(currentEngineeringReadWhere(actor));
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    status: { not: "DESIGN" },
    OR: [
      { tasks: { some: { assigneeId: actor.id } } },
      ...(hasRole(actor.roles, "MOUNTER") ? [{ mounterId: actor.id }] : []),
      ...(hasRole(actor.roles, "WORKER") ? [{ assemblerId: actor.id, assembler: { active: true, roles: { hasSome: ["WORKER" as const] } } }] : []),
      { id: { in: actor.fieldParticipantProductIds ?? [] } },
      { project: { tasks: { some: { assigneeId: actor.id, productId: null } } } },
    ],
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function assignedProjectVisibilityWhere(actor: VisibilityActor): Prisma.ProjectWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProjectWhereInput[] = [];
  grants.push({ products: { some: assignedProductVisibilityWhere(actor) } });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    products: { none: {} }, tasks: { some: { assigneeId: actor.id, productId: null } },
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function taskVisibilityWhere(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.TaskWhereInput[] = [];
  grants.push({ product: engineeringProductWhere(actor) });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    assigneeId: actor.id, OR: [
      { product: { status: { not: "DESIGN" } } },
      { productId: null, project: projectVisibilityWhere(actor) },
    ],
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

/** Execution is an assignee/manager grant, not a consequence of read access. */
export function taskExecutionWhere(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  const grants: Prisma.TaskWhereInput[] = hasAnyRole(actor.roles,ASSIGNEE_ROLES) ? [
    { id: { in: actor.engineeringParticipantTaskIds ?? [] }, assigneeId: actor.id, product: { status: "DESIGN" } },
  ] : [];
  // Исполнение даёт производственная или инженерная роль; финансовая роль
  // сама по себе не добавляет задач, а сочетание сохраняет независимые права.
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ assigneeId: actor.id, OR: [
    { product: { status: { not: "DESIGN" } } },
    { productId: null, project: projectVisibilityWhere(actor) },
  ] });
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ assigneeId: actor.id, product: { engineerId: actor.id, status: "DESIGN" } });
  return { OR: grants };
}

export function workVisibilityWhere(actor: VisibilityActor): Prisma.WorkWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.WorkWhereInput[] = [];
  grants.push({ product: engineeringProductWhere(actor) });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    tasks: { some: { assigneeId: actor.id } }, OR: [
      { product: { status: { not: "DESIGN" } } },
      { productId: null, project: projectVisibilityWhere(actor) },
    ],
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

export function fileVisibilityWhere(actor: VisibilityActor): Prisma.FileWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  return {
    AND: [
      { project: assignedProjectVisibilityWhere(actor) },
      { OR: [{ productId: null }, { product: assignedProductVisibilityWhere(actor) }] },
      { OR: [{ taskId: null }, { task: taskVisibilityWhere(actor) }] },
    ],
  };
}

export function clientVisibilityWhere(actor: VisibilityActor): Prisma.ClientWhereInput {
  return hasFullProjectVisibility(actor) ? {} : { projects: { some: projectVisibilityWhere(actor) } };
}

/** Production-wide read is separate from assignment/file/execution grants. */
export function productVisibilityWhere(actor:VisibilityActor):Prisma.ProductWhereInput {
 return hasRole(actor.roles,"WORKER") && !hasFullProjectVisibility(actor)
  ? {OR:[assignedProductVisibilityWhere(actor),{status:"PRODUCTION"}]} : assignedProductVisibilityWhere(actor);
}
export function projectVisibilityWhere(actor:VisibilityActor):Prisma.ProjectWhereInput {
 return hasRole(actor.roles,"WORKER") && !hasFullProjectVisibility(actor)
  ? {OR:[assignedProjectVisibilityWhere(actor),{products:{some:productVisibilityWhere(actor)}}]} : assignedProjectVisibilityWhere(actor);
}
