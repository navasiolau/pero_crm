import {liveProjectWhere,liveProductWhere,liveChildWhere} from "./live-entities";
import type { Prisma, ProductStatus, Role } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole, hasWorkCoordinator } from "@/lib/roles";
import { canAccessProductDraft, canViewProductDrafts, type ProductDraftAccessContext } from "@/lib/product-drafts";
import { fieldProductStatuses } from "@/lib/field-product-visibility";
import { ENGINEER_PRODUCT_STATUSES, ENGINEER_PROJECT_STAGES } from "@/lib/engineering-read-access";

export type VisibilityActor = { id: string; roles: Role[]; engineeringParticipantProductIds?: string[];
  engineeringParticipantTaskIds?: string[]; fieldParticipantProductIds?: string[] };

/** Participant membership comes from assignments, including zero-share tasks. */
function engineeringProductWhereGrants(actor: VisibilityActor): Prisma.ProductWhereInput {
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
function currentEngineeringReadWhereGrants(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (!hasRole(actor.roles, "ENGINEER")) return { id: { in: [] } };
  return { engineerId: actor.id, status: { in: ["DESIGN", "PRODUCTION"] } };
}

/** Самостоятельное чтение инженера; назначение и участие определяют права изменения. */
function engineeringProjectReadWhere(actor: VisibilityActor): Prisma.ProjectWhereInput {
  return hasRole(actor.roles, "ENGINEER") ? { stage: { in: [...ENGINEER_PROJECT_STAGES] } } : { id: { in: [] } };
}

export function engineeringGlobalReadWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  return { AND: [liveProductWhere, hasRole(actor.roles, "ENGINEER") ? {
    status: { in: [...ENGINEER_PRODUCT_STATUSES] }, project: engineeringProjectReadWhere(actor),
  } : { id: { in: [] } }] };
}

function productReadWhereGrants(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProductWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push(engineeringGlobalReadWhere(actor));
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ status: { in: fieldProductStatuses(actor.roles) } });
  return { OR: grants };
}

function projectReadWhereGrants(actor: VisibilityActor): Prisma.ProjectWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProjectWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push(engineeringProjectReadWhere(actor));
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ OR: [
    { products: { some: { AND: [liveProductWhere, { status: { in: fieldProductStatuses(actor.roles) } }] } } },
    { products: { none: {} }, tasks: { some: { assigneeId: actor.id, productId: null } } },
  ] });
  return { OR: grants };
}

/** Use inside a mutation transaction for synchronous technical permission checks. */
export async function resolveVisibilityActor(
  db: Pick<Prisma.TransactionClient, "task"> & Partial<Pick<Prisma.TransactionClient, "productPercentageParticipant">>,
  actor: VisibilityActor,
): Promise<VisibilityActor> {
  const assignments = hasRole(actor.roles, "ENGINEER") ? await engineeringAssignments(db, actor.id, true) : [];
  const direct = hasRole(actor.roles, "ENGINEER") && db.productPercentageParticipant ? await db.productPercentageParticipant.findMany({
    where: { userId: actor.id, config: { kind: "ENGINEERING", product: { status: "DESIGN" } } },
    select: { config: { select: { productId: true } } },
  }) : [];
  const field = hasAnyRole(actor.roles, FIELD_ROLES) && db.productPercentageParticipant ? await db.productPercentageParticipant.findMany({
    where: { userId: actor.id, config: { kind: "INSTALLATION", product: { status: { in: fieldProductStatuses(actor.roles) } } } },
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
function productEditWhereGrants(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  return engineeringProductWhere(actor);
}

export function canEditProductTechnicalBlock(actor: VisibilityActor, product: ProductDraftAccessContext & { id?: string; engineerId: string | null; status: ProductStatus }): boolean {
  return (product.status !== "DRAFT" || canAccessProductDraft(actor.roles, product)) && (hasAnyRole(actor.roles, MANAGER_ROLES) || (
    product.status === "DESIGN" && (
      (hasRole(actor.roles, "ENGINEER") && product.engineerId === actor.id) ||
      (hasRole(actor.roles, "ENGINEER") && !!product.id && !!actor.engineeringParticipantProductIds?.includes(product.id))
    )
  ));
}

function assignedProductVisibilityWhereGrants(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProductWhereInput[] = [];
  grants.push(currentEngineeringReadWhere(actor));
  // Участник технического блока сохраняет чтение изделия/эскиза только на DESIGN.
  if (hasRole(actor.roles, "ENGINEER") && actor.engineeringParticipantProductIds?.length)
    grants.push(engineeringProductWhere(actor));
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    status: { in: fieldProductStatuses(actor.roles) },
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

function assignedProjectVisibilityWhereGrants(actor: VisibilityActor): Prisma.ProjectWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.ProjectWhereInput[] = [];
  grants.push({ products: { some: assignedProductVisibilityWhere(actor) } });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    products: { none: {} }, tasks: { some: { assigneeId: actor.id, productId: null } },
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

function taskVisibilityWhereGrants(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.TaskWhereInput[] = [];
  grants.push({ project: engineeringProjectReadWhere(actor),
    product: { AND: [engineeringProductWhere(actor), engineeringGlobalReadWhere(actor)] } });
  // Ответственный читает обычные задачи только уже доступных ему изделий; execution grant отдельный.
  if (hasWorkCoordinator(actor.roles)) grants.push({
    work: { paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null },
    product: productVisibilityWhere(actor),
  });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    assigneeId: actor.id, OR: [
      { product: { status: { in: fieldProductStatuses(actor.roles) } } },
      { productId: null, project: projectVisibilityWhere(actor) },
    ],
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

/** Execution is an assignee/manager grant, not a consequence of read access. */
function taskExecutionWhereGrants(actor: VisibilityActor): Prisma.TaskWhereInput {
  if (hasAnyRole(actor.roles, MANAGER_ROLES)) return {};
  const grants: Prisma.TaskWhereInput[] = hasRole(actor.roles, "ENGINEER") ? [
    { id: { in: actor.engineeringParticipantTaskIds ?? [] }, assigneeId: actor.id, product: { status: "DESIGN" } },
  ] : [];
  // Исполнение даёт производственная или инженерная роль; финансовая роль
  // сама по себе не добавляет задач, а сочетание сохраняет независимые права.
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ assigneeId: actor.id, OR: [
    { product: { status: { in: fieldProductStatuses(actor.roles) } } },
    { productId: null, project: projectVisibilityWhere(actor) },
  ] });
  if (hasRole(actor.roles, "ENGINEER")) grants.push({ assigneeId: actor.id, product: { engineerId: actor.id, status: "DESIGN" } });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

function assignedWorkVisibilityWhereGrants(actor: VisibilityActor): Prisma.WorkWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.WorkWhereInput[] = [];
  grants.push({ product: engineeringProductWhere(actor) });
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({
    tasks: { some: { assigneeId: actor.id } }, OR: [
      { product: { status: { in: fieldProductStatuses(actor.roles) } } },
      { productId: null, project: projectVisibilityWhere(actor) },
    ],
  });
  return grants.length ? { OR: grants } : { id: { in: [] } };
}

/** Каждый указанный контекст файла должен проходить производственную матрицу. */
function fieldFileWhere(actor: VisibilityActor): Prisma.FileWhereInput {
  const product: Prisma.ProductWhereInput = {
    AND: [liveProductWhere, { status: { in: fieldProductStatuses(actor.roles) } }],
  };
  const task: Prisma.TaskWhereInput = { AND: [liveChildWhere, { product }] };
  return {
    AND: [
      { OR: [{ product }, { task }] },
      { OR: [{ productId: null }, { product }] },
      { OR: [{ taskId: null }, { task }] },
    ],
  };
}

/** Общий файл проекта: инженерный этап либо самостоятельное назначение FIELD. */
export function generalProjectFileVisibilityWhere(actor: VisibilityActor): Prisma.ProjectWhereInput {
  if (hasFullProjectVisibility(actor)) return liveProjectWhere;
  const grants: Prisma.ProjectWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) grants.push(engineeringProjectReadWhere(actor));
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push(assignedProjectVisibilityWhere({
    ...actor, roles: actor.roles.filter(role => role !== "ENGINEER"),
  }));
  return { AND: [liveProjectWhere, { OR: grants }] };
}

function fileVisibilityWhereGrants(actor: VisibilityActor): Prisma.FileWhereInput {
  if (hasFullProjectVisibility(actor)) return {};
  const grants: Prisma.FileWhereInput[] = [];
  if (hasRole(actor.roles, "ENGINEER")) {
    const product = engineeringGlobalReadWhere(actor);
    const task: Prisma.TaskWhereInput = { AND: [liveChildWhere, {
      project: engineeringProjectReadWhere(actor),
      OR: [{ productId: null }, { product }],
    }] };
    grants.push({ AND: [
      { project: generalProjectFileVisibilityWhere({ ...actor, roles: ["ENGINEER"] }) },
      { section: { in: ["GENERAL", "MEASUREMENT", "PRODUCTION", "INSTALLATION"] } },
      { OR: [{ productId: null }, { product }] },
      { OR: [{ taskId: null }, { task }] },
    ] });
  }
  if (!hasAnyRole(actor.roles, FIELD_ROLES)) return { OR: grants };
  // В файловый grant FIELD не подмешиваем прежнее инженерное назначение:
  // инженерное чтение выше всегда проверяет доступный этап родителя.
  const fieldActor = { ...actor, roles: actor.roles.filter(role => role !== "ENGINEER") };
  const base: Prisma.FileWhereInput = {
    AND: [
      { project: generalProjectFileVisibilityWhere(fieldActor) },
      { OR: [{ productId: null }, { product: assignedProductVisibilityWhere(fieldActor) }] },
      { OR: [{ taskId: null }, { task: taskVisibilityWhere(fieldActor) }] },
    ],
  };
  // Общие проектные файлы сохраняют прежний assigned grant; файлы изделий
  // доступны по матрице, включая неназначенного исполнителя.
  return { OR: [...grants, base, fieldFileWhere(fieldActor)] };
}

export function clientVisibilityWhere(actor: VisibilityActor): Prisma.ClientWhereInput {
  return hasFullProjectVisibility(actor) ? {} : { projects: { some: projectVisibilityWhere(actor) } };
}

/** Дополнительное ограничение, не заменяющее обычные grants или soft-delete. */
export function productDraftVisibilityWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  if (canViewProductDrafts(actor.roles)) return {};
  if (!hasRole(actor.roles, "MANAGER")) return { status: { not: "DRAFT" } };
  // Same-project связь защищена ограничениями ProposalItem в БД; grant даёт
  // только сама действующая позиция КП, не остальные черновики её проекта.
  return { OR: [{ status: { not: "DRAFT" } }, {
    deletedAt: null, project: liveProjectWhere,
    proposalItem: { is: { deletedAt: null, proposal: {
      deletedAt: null, isArchive: false, projectId: { not: null }, project: liveProjectWhere,
    } } },
  }] };
}

function draftChildVisibilityWhere(actor: VisibilityActor) {
  return canViewProductDrafts(actor.roles) ? {} : {
    OR: [{ productId: null }, { product: productDraftVisibilityWhere(actor) }],
  };
}

function draftFileVisibilityWhere(actor: VisibilityActor): Prisma.FileWhereInput {
  if (canViewProductDrafts(actor.roles)) return {};
  return { AND: [
    draftChildVisibilityWhere(actor),
    { OR: [{ taskId: null }, { task: draftChildVisibilityWhere(actor) }] },
  ] };
}

export function productEditWhere(actor:VisibilityActor):Prisma.ProductWhereInput {return {AND:[liveProductWhere,productDraftVisibilityWhere(actor),productEditWhereGrants(actor)]};}

/** Прежняя область записи работ и файлов; глобальное чтение её не расширяет. */
export function productAssignmentWriteWhere(actor: VisibilityActor): Prisma.ProductWhereInput {
  const grants: Prisma.ProductWhereInput[] = [assignedProductVisibilityWhere(actor)];
  if (hasAnyRole(actor.roles, FIELD_ROLES)) grants.push({ status: { in: fieldProductStatuses(actor.roles) } });
  return { AND: [liveProductWhere, productDraftVisibilityWhere(actor), { OR: grants }] };
}

export function productVisibilityWhere(actor:VisibilityActor):Prisma.ProductWhereInput {return {AND:[liveProductWhere,productDraftVisibilityWhere(actor),productReadWhereGrants(actor)]};}

export function projectVisibilityWhere(actor:VisibilityActor):Prisma.ProjectWhereInput {return {AND:[liveProjectWhere,projectReadWhereGrants(actor)]};}

export function taskVisibilityWhere(actor:VisibilityActor):Prisma.TaskWhereInput {return {AND:[liveChildWhere,draftChildVisibilityWhere(actor),taskVisibilityWhereGrants(actor)]};}

export function taskExecutionWhere(actor:VisibilityActor):Prisma.TaskWhereInput {return {AND:[liveChildWhere,draftChildVisibilityWhere(actor),taskExecutionWhereGrants(actor)]};}

export function workVisibilityWhere(actor:VisibilityActor):Prisma.WorkWhereInput {return {AND:[liveChildWhere,draftChildVisibilityWhere(actor),(hasAnyRole(actor.roles,FIELD_ROLES)||hasWorkCoordinator(actor.roles))&&!hasFullProjectVisibility(actor)
 ? {OR:[assignedWorkVisibilityWhere(actor),{paymentKind:"LEGACY",stagePayPoolId:null,poolWeightUnits:null,product:hasWorkCoordinator(actor.roles)?productVisibilityWhere(actor):{status:{in:fieldProductStatuses(actor.roles)}}}]} : assignedWorkVisibilityWhereGrants(actor)]};}

export function fileVisibilityWhere(actor:VisibilityActor):Prisma.FileWhereInput {return {AND:[liveChildWhere,draftFileVisibilityWhere(actor),
  // Используемая другой обложкой управляемая копия сохраняет доступ до снятия последней ссылки.
  {OR:[{proposalMediaRetiredAt:null},{sketchForProduct:{isNot:null}},{coverForProject:{isNot:null}}]},fileVisibilityWhereGrants(actor)]};}

export function engineeringProductWhere(actor:VisibilityActor):Prisma.ProductWhereInput {return {AND:[liveProductWhere,engineeringProductWhereGrants(actor)]};}

export function currentEngineeringReadWhere(actor:VisibilityActor):Prisma.ProductWhereInput {return {AND:[liveProductWhere,currentEngineeringReadWhereGrants(actor)]};}


/** Назначение остаётся самостоятельным grant для технических и исполнительских проверок. */
export function assignedProductVisibilityWhere(actor:VisibilityActor):Prisma.ProductWhereInput {return {AND:[liveProductWhere,productDraftVisibilityWhere(actor),assignedProductVisibilityWhereGrants(actor)]};}
export function assignedProjectVisibilityWhere(actor:VisibilityActor):Prisma.ProjectWhereInput {return {AND:[liveProjectWhere,assignedProjectVisibilityWhereGrants(actor)]};}

export function assignedWorkVisibilityWhere(actor:VisibilityActor):Prisma.WorkWhereInput {return {AND:[liveChildWhere,draftChildVisibilityWhere(actor),assignedWorkVisibilityWhereGrants(actor)]};}
