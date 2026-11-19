import type { PrismaClient, ProjectStage } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { canManageProductFiles, canManageProjectFiles } from "@/lib/file-management";
import { liveTaskWhere } from "@/server/access/live-entities";
import { projectVisibilityWhere, productVisibilityWhere, productAssignmentWriteWhere, resolveVisibilityActor, taskVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";

/** Validate every foreign key before any storage write; task-only uploads inherit its product. */
export async function resolveUploadContext(
  db: Pick<PrismaClient, "project" | "product" | "task">,
  actor: VisibilityActor,
  input: { projectId: string; productId: string | null; taskId: string | null },
) {
  actor = await resolveVisibilityActor(db, actor);
  const project = await db.project.findFirst({
    where: { AND: [
      { id: input.projectId },
      projectVisibilityWhere(actor),
    ] },
    select: {
      id: true, number: true, stage: true,
      tasks: { where: { AND:[{ assigneeId: actor.id },taskVisibilityWhere(actor)] }, select: { id: true }, take: 1 },
    },
  });
  if (!project) return null;
  let productId = input.productId;
  let ownsTask = false;
  if (input.taskId) {
    const task = await db.task.findFirst({
      where: { AND: [
        { id: input.taskId, projectId: input.projectId },
        { OR: [taskVisibilityWhere(actor), ...(hasRole(actor.roles, "ENGINEER") ? [{ AND: [
          liveTaskWhere,
          { project: projectVisibilityWhere(actor), OR: [{ productId: null }, { product: productVisibilityWhere(actor) }] },
        ] }] : [])] },
      ] },
      select: { productId: true, assigneeId: true },
    });
    if (!task || (productId !== null && productId !== task.productId)) return null;
    productId = task.productId;
    ownsTask = task.assigneeId === actor.id;
  }
  const product = productId ? await db.product.findFirst({
    where: { AND: [{ id: productId, projectId: input.projectId }, { OR: [
      productAssignmentWriteWhere(actor),
      ...(hasRole(actor.roles, "ENGINEER") ? [productVisibilityWhere(actor)] : []),
    ] }] },
    select: { id: true, number: true, engineerId: true, status: true },
  }) : null;
  if (productId && !product) return null;
  const managerGrant = hasAnyRole(actor.roles, MANAGER_ROLES);
  const engineerGrant = hasRole(actor.roles, "ENGINEER") && (product
    ? canManageProductFiles(actor.roles, product)
    : canManageProjectFiles(actor.roles, project.stage));
  // Existing field access was project-based (a project with one's own task).
  // When a task is explicitly supplied, it must also belong to that actor.
  const legacyAssigneeGrant = !hasRole(actor.roles, "ENGINEER") || hasAnyRole(actor.roles, FIELD_ROLES);
  const fieldGrant = legacyAssigneeGrant && project.tasks.length > 0 && (!input.taskId || ownsTask);
  if (!managerGrant && !engineerGrant && !fieldGrant) return null;
  return { project: { id: project.id, number: project.number }, productId, productNumber: product?.number ?? null,
    canManageAnyFile: managerGrant || engineerGrant };
}

/** Общие вложения сохраняют самостоятельный FIELD grant; обложка его не наследует. */
export async function projectFilePermissions(
  db: Parameters<typeof resolveUploadContext>[0],
  actor: VisibilityActor,
  project: { id: string; stage: ProjectStage },
) {
  const canManageCover = canManageProjectFiles(actor.roles, project.stage);
  const canUpload = canManageCover || (hasRole(actor.roles, "ENGINEER") && hasAnyRole(actor.roles, FIELD_ROLES) &&
    !!await resolveUploadContext(db, actor, { projectId: project.id, productId: null, taskId: null }));
  return { canUpload, canManageCover };
}
