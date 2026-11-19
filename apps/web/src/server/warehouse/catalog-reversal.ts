import { Prisma, type Role } from "@prisma/client";
import { MANAGER_ROLES, WAREHOUSE_MANAGE_ROLES, WAREHOUSE_UNIT_ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { productVisibilityWhere } from "@/server/access/visibility";
import { journalProductContext } from "@/server/finance/journal";
import { lockProductRow } from "@/server/products/quantity-core";
import { decimalAtoms, materialPlanFloor, scaleNorm } from "@/lib/product-quantity";
import { warehouseMetadataGate } from "./gate";
import { readIssuedQuantity } from "./issued-quantity";
import { catalogCommand, catalogMovementCount, categorySnapshot, materialSnapshot, needSnapshot, unitSnapshot,
  warehouseCatalogKind, warehouseCatalogSchema, type WarehouseCatalogData } from "./catalog-reversal-contract";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; roles: Role[] };
const refuse = (message: string): never => { throw new JournalReversalRefusal(message); };
const commonPaths = ["/warehouse", "/warehouse/stock", "/warehouse/items", "/warehouse/movements", "/settings/warehouse-units", "/finance", "/products", "/projects"];

async function prepare(tx: Tx, actor: Actor, id: string, command: WarehouseCatalogData, locking = false) {
  const entity = command.entity;
  const roles = entity === "projectMaterial" ? MANAGER_ROLES : entity === "materialUnit" ? WAREHOUSE_UNIT_ADMIN_ROLES : WAREHOUSE_MANAGE_ROLES;
  if (!hasAnyRole(actor.roles, roles)) refuse("Недостаточно прав для отката справочника");
  if (locking) await warehouseMetadataGate(tx);

  if (entity === "materialUnit") {
    if (locking) await tx.$queryRaw`SELECT id FROM "MaterialUnit" WHERE id=${id} FOR UPDATE`;
    const row = await tx.materialUnit.findUnique({ where: { id } });
    if (!row || row.warehouseCatalogRevision !== command.expectedRevision) throw new JournalReversalRefusal("Единица измерения изменилась");
    if (command.restore.deleted && await tx.material.count({ where: { unitId: id } }))
      refuse("Единица используется в номенклатуре, включая неактивные материалы");
    const existing = await tx.materialUnit.findUnique({ where: { name: command.restore.name }, select: { id: true } });
    if (existing && existing.id !== row.id) refuse("Прежнее обозначение уже используется");
    const { name, deleted } = command.restore, before = unitSnapshot(row);
    return async () => {
      const result = await tx.materialUnit.update({ where: { id }, data: { name,
        deletedAt: deleted ? new Date() : null, deletedById: deleted ? actor.id : null } });
      const inverse = await catalogCommand(tx, { entity, before: row, after: result }, command.createdLifecycle);
      return { inverse: inverse.data, oldValue: before, newValue: unitSnapshot(result), cachePaths: commonPaths };
    };
  }

  if (entity === "materialCategory") {
    if (locking) await tx.$queryRaw`SELECT id FROM "MaterialCategory" WHERE id=${id} FOR UPDATE`;
    const row = await tx.materialCategory.findUnique({ where: { id } });
    if (!row || row.warehouseCatalogRevision !== command.expectedRevision) throw new JournalReversalRefusal("Категория изменилась");
    if (command.createdLifecycle && !command.restore.active && await tx.material.count({ where: { categoryId: id } }))
      refuse("У категории уже есть связанные материалы");
    return async () => {
      const result = await tx.materialCategory.update({ where: { id }, data: command.restore });
      const inverse = await catalogCommand(tx, { entity, before: row, after: result }, command.createdLifecycle);
      return { inverse: inverse.data, oldValue: categorySnapshot(row), newValue: categorySnapshot(result), cachePaths: commonPaths };
    };
  }

  if (entity === "material") {
    if (locking) await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${id} FOR UPDATE`;
    const row = await tx.material.findUnique({ where: { id } });
    if (!row || row.warehouseCatalogRevision !== command.expectedRevision) throw new JournalReversalRefusal("Материал изменился");
    if (command.movementCount !== await catalogMovementCount(tx, { materialId: id }))
      refuse("После изменения материала появились складские движения");
    const { unitId, categoryId } = command.restore;
    if (unitId !== row.unitId || command.restore.active) {
      if (locking) await tx.$queryRaw`SELECT id FROM "MaterialUnit" WHERE id=${unitId} FOR SHARE`;
      if (!await tx.materialUnit.findUnique({ where: { id: unitId, deletedAt: null }, select: { id: true } }))
        refuse("Прежняя единица измерения удалена");
    }
    if (categoryId && categoryId !== row.categoryId) {
      if (locking) await tx.$queryRaw`SELECT id FROM "MaterialCategory" WHERE id=${categoryId} FOR SHARE`;
      if (!await tx.materialCategory.findUnique({ where: { id: categoryId, active: true }, select: { id: true } }))
        refuse("Прежняя категория больше недоступна");
    }
    if (command.createdLifecycle && !command.restore.active && (
      await tx.projectMaterial.count({ where: { materialId: id, deletedAt: null } }) ||
      await tx.logisticsShipmentLine.count({ where: { materialId: id } })
    )) refuse("У материала появились потребности или отгрузки");
    return async () => {
      const result = await tx.material.update({ where: { id }, data: command.restore });
      const inverse = await catalogCommand(tx, { entity, before: row, after: result }, command.createdLifecycle);
      return { inverse: inverse.data, oldValue: materialSnapshot(row), newValue: materialSnapshot(result), cachePaths: commonPaths };
    };
  }

  if (locking) {
    const owner = await tx.projectMaterial.findUnique({ where: { id }, select: { productId: true, materialId: true } });
    if (owner) {
      await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${owner.materialId} FOR SHARE`;
      await lockProductRow(tx, owner.productId);
      await tx.$queryRaw`SELECT id FROM "ProjectMaterial" WHERE id=${id} FOR UPDATE`;
    }
  }
  const row = await tx.projectMaterial.findUnique({ where: { id, product: productVisibilityWhere(actor) },
    include: { product: { select: { id: true, number: true, projectId: true, quantity: true } }, material: { select: { active: true } } } });
  if (!row || row.warehouseCatalogRevision !== command.expectedRevision) throw new JournalReversalRefusal("Потребность изменилась или недоступна");
  if (command.movementCount !== await catalogMovementCount(tx, row)) refuse("После изменения потребности появились складские движения");
  const { quantity, quantityPerUnit, comment, deleted } = command.restore;
  if (!deleted && !row.material.active) refuse("Материал больше недоступен");
  if (deleted && row.issuedQty.gt(0)) refuse("По потребности есть выдача со склада");
  if (!deleted && quantityPerUnit !== null && !new Prisma.Decimal(quantity).eq(scaleNorm(quantityPerUnit, row.product.quantity, 3, 12)))
    refuse("Количество изделия изменилось, прежняя норма не соответствует партии");
  const issuedQty = await readIssuedQuantity(tx, row.productId, row.materialId);
  if (decimalAtoms(issuedQty, 3, 12) !== decimalAtoms(row.issuedQty, 3, 12))
    refuse("Количество выданного материала изменилось");
  if (!deleted && decimalAtoms(quantity, 3, 12) < decimalAtoms(materialPlanFloor(row.quantity, row.issuedQty), 3, 12))
    refuse("Прежний объём меньше уже выданного материала");
  return async () => {
    const result = await tx.projectMaterial.update({ where: { id }, data: {
      quantity, quantityPerUnit, comment, deletedAt: deleted ? new Date() : null, deletedById: deleted ? actor.id : null,
    } });
    const inverse = await catalogCommand(tx, { entity, before: row, after: result }, command.createdLifecycle);
    return { inverse: inverse.data, oldValue: needSnapshot(row), newValue: needSnapshot(result),
      hints: { contexts: [journalProductContext(row.product)] },
      cachePaths: [...commonPaths, `/projects/${row.product.projectId}`, `/products/${row.productId}`, `/products/${row.product.number}`] };
  };
}

export const warehouseCatalogReversal = defineJournalReversal({
  kind: warehouseCatalogKind,
  version: 1,
  schema: warehouseCatalogSchema,
  async preview(ctx, data) {
    try {
      await prepare(ctx.tx, ctx.actor, ctx.entityId, data);
      return null;
    } catch (error) {
      if (error instanceof JournalReversalRefusal) return error.message;
      throw error;
    }
  },
  async apply(ctx, data) {
    const apply = await prepare(ctx.tx, ctx.actor, ctx.entityId, data, true);
    return apply();
  },
});
