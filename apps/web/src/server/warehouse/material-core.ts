import type { Prisma } from "@prisma/client";
import { hasAnyRole, WAREHOUSE_MANAGE_ROLES } from "@/lib/roles";
import type { DomainActor } from "@/server/actor";
import { materialSchema, type MaterialCreateResult } from "./material-contracts";

export async function requireMaterialUnit(tx: Prisma.TransactionClient, unitId: string) {
  const unit = await tx.materialUnit.findUnique({ where: { id: unitId }, select: { id: true, name: true } });
  if (!unit) throw Error("Единица измерения не найдена. Обновите список единиц.");
  return unit;
}

export function materialCatalogError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") {
    return "Выбранная единица или категория больше недоступна. Обновите справочник.";
  }
  return error instanceof Error ? error.message : "Не удалось сохранить материал";
}

/** Вызывается только внутри withWarehouseWrite: metadata gate и аудит сохраняют одну транзакцию. */
export async function createMaterialInTransaction(actor: DomainActor, input: unknown, tx: Prisma.TransactionClient): Promise<MaterialCreateResult> {
  if (!hasAnyRole(actor.roles, WAREHOUSE_MANAGE_ROLES)) return { ok: false, error: "Недостаточно прав" };
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data = parsed.data;
  await requireMaterialUnit(tx, data.unitId);
  if (data.categoryId) {
    const category = await tx.materialCategory.findUnique({ where: { id: data.categoryId }, select: { active: true } });
    if (!category?.active) return { ok: false, error: "Категория не найдена" };
  }
  const material = await tx.material.create({ data: {
    name: data.name, sku: data.sku?.trim() || null, unitId: data.unitId,
    categoryId: data.categoryId || null, purchasePrice: 0, minStock: data.minStock ?? null,
    comment: data.comment?.trim() || null,
  }, include: { measurementUnit: { select: { name: true } } } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "material", entityId: material.id, action: "create",
    newValue: { name: material.name, sku: material.sku, unitId: material.unitId, unit: material.measurementUnit.name, purchasePrice: 0 },
  } });
  return { ok: true, material: { id: material.id, name: material.name, unit: material.measurementUnit.name, sku: material.sku, stock: 0 } };
}
