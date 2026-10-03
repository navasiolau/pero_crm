import type { PrismaClient } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { engineeringProductWhere, productVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, taskVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";

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
      id: true, number: true,
      products: { where: engineeringProductWhere(actor), select: { id: true }, take: 1 },
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
        taskVisibilityWhere(actor),
      ] },
      select: { productId: true, assigneeId: true },
    });
    if (!task || (productId !== null && productId !== task.productId)) return null;
    productId = task.productId;
    ownsTask = task.assigneeId === actor.id;
  }
  const product = productId ? await db.product.findFirst({
    where: { AND: [{ id: productId, projectId: input.projectId }, productVisibilityWhere(actor)] },
    select: { id: true, number: true, engineerId: true, status: true },
  }) : null;
  if (productId && !product) return null;
  const managerGrant = hasAnyRole(actor.roles, MANAGER_ROLES);
  const engineerGrant = (product
    ? product.status === "DESIGN" && ((hasRole(actor.roles, "ENGINEER") && product.engineerId === actor.id) || actor.engineeringParticipantProductIds?.includes(product.id))
    // Only an unbound project file inherits access through a DESIGN product.
    // A common task still needs its own execution/field or manager grant.
    : !input.taskId && project.products.length > 0);
  // Existing field access was project-based (a project with one's own task).
  // When a task is explicitly supplied, it must also belong to that actor.
  const legacyAssigneeGrant = !hasRole(actor.roles, "ENGINEER") || hasAnyRole(actor.roles, FIELD_ROLES);
  const fieldGrant = legacyAssigneeGrant && project.tasks.length > 0 && (!input.taskId || ownsTask);
  if (!managerGrant && !engineerGrant && !fieldGrant) return null;
  return { project: { id: project.id, number: project.number }, productId, productNumber: product?.number ?? null };
}
