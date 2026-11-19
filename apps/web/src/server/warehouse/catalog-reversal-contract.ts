import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const warehouseCatalogKind = "warehouse.catalog";
const common = { expectedRevision: z.number().int().nonnegative(), createdLifecycle: z.boolean(), movementCount: z.number().int().nonnegative() };
const category = z.object({ name: z.string(), comment: z.string().nullable(), active: z.boolean() }).strict();
const material = category.extend({ sku: z.string().nullable(), unitId: z.string(), categoryId: z.string().nullable(), minStock: z.string().nullable() }).strict();
const unit = z.object({ name: z.string(), deleted: z.boolean() }).strict();
const need = z.object({ quantity: z.string(), quantityPerUnit: z.string().nullable(), comment: z.string().nullable(), deleted: z.boolean() }).strict();
export const warehouseCatalogSchema = z.discriminatedUnion("entity", [
  z.object({ ...common, entity: z.literal("materialCategory"), restore: category }).strict(),
  z.object({ ...common, entity: z.literal("material"), restore: material }).strict(),
  z.object({ ...common, entity: z.literal("materialUnit"), restore: unit }).strict(),
  z.object({ ...common, entity: z.literal("projectMaterial"), restore: need }).strict(),
]);
export type WarehouseCatalogData = z.infer<typeof warehouseCatalogSchema>;

type Meta = { warehouseCatalogRevision: number };
type Deleted = { deletedAt: Date | null };
type Category = Meta & { name: string; comment: string | null; active: boolean };
type Material = Category & { sku: string | null; unitId: string; categoryId: string | null; minStock: Prisma.Decimal | null; id: string };
type Unit = Meta & Deleted & { name: string };
type Need = Meta & Deleted & { quantity: Prisma.Decimal; quantityPerUnit: Prisma.Decimal | null; comment: string | null; productId: string; materialId: string };

export function categorySnapshot(row: Category) {
  return { name: row.name, comment: row.comment, active: row.active };
}
export function materialSnapshot(row: Material) {
  return { ...categorySnapshot(row), sku: row.sku, unitId: row.unitId, categoryId: row.categoryId, minStock: row.minStock?.toString() ?? null };
}
export function unitSnapshot(row: Unit) { return { name: row.name, deleted: row.deletedAt !== null }; }
export function needSnapshot(row: Need) {
  return { quantity: row.quantity.toString(), quantityPerUnit: row.quantityPerUnit?.toString() ?? null, comment: row.comment, deleted: row.deletedAt !== null };
}

type CatalogVariant<K extends WarehouseCatalogData["entity"], R> = { entity: K; before: R | null; after: R };
type Transition = CatalogVariant<"materialCategory", Category> | CatalogVariant<"material", Material> |
  CatalogVariant<"materialUnit", Unit> | CatalogVariant<"projectMaterial", Need>;

export async function catalogMovementCount(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: { materialId: string; productId?: string }) {
  const count = key.productId
    ? await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::integer AS count FROM "StockMovement" WHERE "materialId"=${key.materialId} AND "productId"=${key.productId}`
    : await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::integer AS count FROM "StockMovement" WHERE "materialId"=${key.materialId}`;
  return count[0]?.count ?? 0;
}

export async function catalogCommand(tx: Pick<Prisma.TransactionClient, "$queryRaw">, change: Transition, createdLifecycle = change.before === null) {
  const expectedRevision = change.after.warehouseCatalogRevision;
  let data: WarehouseCatalogData;
  switch (change.entity) {
    case "materialCategory":
      data = { entity: change.entity, expectedRevision, createdLifecycle, movementCount: 0,
        restore: change.before ? categorySnapshot(change.before) : { ...categorySnapshot(change.after), active: false } };
      break;
    case "material":
      data = { entity: change.entity, expectedRevision, createdLifecycle, movementCount: await catalogMovementCount(tx, { materialId: change.after.id }),
        restore: change.before ? materialSnapshot(change.before) : { ...materialSnapshot(change.after), active: false } };
      break;
    case "materialUnit":
      data = { entity: change.entity, expectedRevision, createdLifecycle, movementCount: 0,
        restore: change.before ? unitSnapshot(change.before) : { ...unitSnapshot(change.after), deleted: true } };
      break;
    case "projectMaterial":
      data = { entity: change.entity, expectedRevision, createdLifecycle, movementCount: await catalogMovementCount(tx, change.after),
        restore: change.before ? needSnapshot(change.before) : { ...needSnapshot(change.after), deleted: true } };
      break;
  }
  return { kind: warehouseCatalogKind, version: 1, data };
}
