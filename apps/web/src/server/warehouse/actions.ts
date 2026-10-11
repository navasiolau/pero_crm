"use server";
import { productVisibilityWhere } from "@/server/access/visibility";


import { z } from "zod";
import { revalidatePath } from "next/cache";
import { deliverPostCommit } from "@/server/operations/post-commit";

import { prisma } from "@/lib/prisma";

import { writeChangeLog } from "@/server/plugins/changelog";


import { revalidateWarehouse } from "./revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { addMaterialNorm, updateMaterialNorm, lockMaterialProduct } from "./norm-core";
import { stockInventoryReceiptSchema, stockIssueSchema, stockReturnSchema } from "./contracts";
import { withWarehouseWrite } from "./accounting";
import { createStockMovementCore } from "./movement-service";
import {MANAGER_ROLES,WAREHOUSE_MANAGE_ROLES} from "@/lib/roles";
import { requireRole } from "@/server/require-role";

// Склад (§12, фаза 6). Правки — админ/директор/менеджер; просмотр — офисные
// роли (разграничение на страницах). Цены — BYN; EXPENSE/RETURN несут
// снимок цены (unitPrice/totalByn) и идут в экономику проекта (§11).



// ─── Категории ────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1, "Укажите название"),
  comment: z.string().optional(),
});

export async function addMaterialCategory(
  input: z.input<typeof categorySchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const category = await withWarehouseWrite((tx)=>tx.materialCategory.create({
    data: {
      name: parsed.data.name,
      comment: parsed.data.comment?.trim() || null,
    },
  }));
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "materialCategory",
    entityId: category.id,
    action: "create",
    newValue: { name: category.name },
  });
  await revalidateWarehouse();
  return { ok: true };
}

export async function toggleMaterialCategory(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const category = await prisma.materialCategory.findUnique({ where: { id } });
  if (!category) return { ok: false, error: "Категория не найдена" };
  await withWarehouseWrite((tx)=>tx.materialCategory.update({
    where: { id },
    data: { active: !category.active },
  }));
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "materialCategory",
    entityId: id,
    action: "update",
    field: "active",
    oldValue: category.active,
    newValue: !category.active,
  });
  await revalidateWarehouse();
  return { ok: true };
}

// ─── Номенклатура ─────────────────────────────────────────────────────────

const materialSchema = z.object({
  name: z.string().trim().min(1, "Укажите название"),
  sku: z.string().optional(),
  unitId: z.string().min(1, "Выберите единицу измерения"),
  categoryId: z.string().optional(),
  minStock: z.number().nonnegative("Мин. остаток не может быть отрицательным").optional(),
  comment: z.string().optional(),
}).strict();

async function requireMaterialUnit(tx: import("@prisma/client").Prisma.TransactionClient, unitId: string) {
  const unit = await tx.materialUnit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) throw Error("Единица измерения не найдена. Обновите список единиц.");
}
function materialCatalogError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") {
    return "Выбранная единица или категория больше недоступна. Обновите справочник.";
  }
  return error instanceof Error ? error.message : "Не удалось сохранить материал";
}

export async function addMaterial(input: z.input<typeof materialSchema>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data = parsed.data;
  if (data.categoryId) {
    const category = await prisma.materialCategory.findUnique({ where: { id: data.categoryId } });
    if (!category || !category.active) return { ok: false, error: "Категория не найдена" };
  }
  let material;
  try {
    material = await withWarehouseWrite(async tx => {
      await requireMaterialUnit(tx, data.unitId);
      return tx.material.create({ data: {
        name: data.name, sku: data.sku?.trim() || null, unitId: data.unitId,
        categoryId: data.categoryId || null, purchasePrice: 0,
        minStock: data.minStock ?? null, comment: data.comment?.trim() || null,
      }, include: { measurementUnit: { select: { name: true } } } });
    });
  } catch (error) { return { ok: false, error: materialCatalogError(error) }; }
  await writeChangeLog({ actorType: "user", actorId: session.user.id, actorName: session.user.name ?? undefined,
    entity: "material", entityId: material.id, action: "create",
    newValue: { name: material.name, sku: material.sku, unitId: material.unitId, unit: material.measurementUnit.name, purchasePrice: 0 },
  });
  await revalidateWarehouse();
  revalidatePath("/settings/warehouse-units");
  return { ok: true };
}

export async function updateMaterial(id: string, input: z.input<typeof materialSchema>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const material = await prisma.material.findUnique({ where: { id }, include: { measurementUnit: { select: { name: true } } } });
  if (!material) return { ok: false, error: "Материал не найден" };
  const data = parsed.data;
  let updated;
  try {
    updated = await withWarehouseWrite(async tx => {
      await requireMaterialUnit(tx, data.unitId);
      return tx.material.update({ where: { id }, data: {
        name: data.name, sku: data.sku?.trim() || null, unitId: data.unitId,
        categoryId: data.categoryId || null, minStock: data.minStock ?? null, comment: data.comment?.trim() || null,
      }, include: { measurementUnit: { select: { name: true } } } });
    });
  } catch (error) { return { ok: false, error: materialCatalogError(error) }; }
  await writeChangeLog({ actorType: "user", actorId: session.user.id, actorName: session.user.name ?? undefined,
    entity: "material", entityId: id, action: "update",
    oldValue: { name: material.name, sku: material.sku, unitId: material.unitId, unit: material.measurementUnit.name },
    newValue: { name: updated.name, sku: updated.sku, unitId: updated.unitId, unit: updated.measurementUnit.name },
  });
  await revalidateWarehouse();
  revalidatePath("/settings/warehouse-units");
  return { ok: true };
}

export async function toggleMaterial(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const material = await prisma.material.findUnique({ where: { id } });
  if (!material) return { ok: false, error: "Материал не найден" };
  await withWarehouseWrite((tx) => tx.material.update({
    where: { id },
    data: { active: !material.active },
  }));
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "material",
    entityId: id,
    action: "update",
    field: "active",
    oldValue: material.active,
    newValue: !material.active,
  });
  await revalidateWarehouse();
  return { ok: true };
}

// ─── Приход на склад ──────────────────────────────────────────────────────

export async function addInventoryReceipt(input: z.input<typeof stockInventoryReceiptSchema>): Promise<{ok:boolean;error?:string}> {
  const session=await requireRole(WAREHOUSE_MANAGE_ROLES);
  return createStockMovementCore({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},"INCOME",input);
}
// Compatibility for already open forms; no separate business logic.
export async function addStockIncome(input: z.input<typeof stockInventoryReceiptSchema>) { return addInventoryReceipt(input); }

// ─── Потребность изделия (простой резерв, без проверки остатка) ──────────

const projectMaterialSchema = z.object({
  productId: z.string().min(1),
  materialId: z.string().min(1, "Выберите материал"),
  quantity: z.number().positive("Количество должно быть больше нуля").optional(),
  quantityPerUnit: z.number().positive("Количество должно быть больше нуля").optional(),
  comment: z.string().optional(),
});

export async function addProjectMaterial(
  input: z.input<typeof projectMaterialSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(MANAGER_ROLES);
  const parsed = projectMaterialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  let mutation;
  try { mutation = await withTaskTransaction(async tx => {
    const result = await addMaterialNorm(tx, data, session.user);
    const { line, product, material } = result;
  await tx.changeLog.create({ data: {
    actorType: "user", source: "web",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: line.id,
    action: "create",
    newValue: {
      product: product.number,
      material: material.name,
      quantity: line.quantity.toString(),
      quantityPerUnit: line.quantityPerUnit?.toString() ?? null,
    },
  } });
    return result;
  }); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось добавить материал" }; }
  const { line, product } = mutation;

  await deliverPostCommit("material-norm-create", line.id, [{kind:"cache",run:()=>revalidateWarehouse(product.id, product.projectId)}]);
  return { ok: true };
}

const updateProjectMaterialSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().positive("Количество должно быть больше нуля").optional(),
  quantityPerUnit: z.number().positive("Количество должно быть больше нуля").optional(),
  comment: z.string().optional(),
});

export async function updateProjectMaterial(
  input: z.input<typeof updateProjectMaterialSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(MANAGER_ROLES);
  const parsed = updateProjectMaterialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  let mutation;
  try { mutation = await withTaskTransaction(async tx => {
    const result = await updateMaterialNorm(tx, parsed.data, session.user);
    const { line, quantity, quantityPerUnit } = result;
  await tx.changeLog.create({ data: {
    actorType: "user", source: "web",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: line.id,
    action: "update",
    field: "quantity",
    oldValue: Number(line.quantity),
    newValue: { quantity, quantityPerUnit },
  } });
    return result;
  }); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить материал" }; }
  const { line } = mutation;

  await deliverPostCommit("material-norm-update", line.id, [{kind:"cache",run:()=>revalidateWarehouse(line.productId, line.product.projectId)}]);
  return { ok: true };
}

export async function deleteProjectMaterial(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(MANAGER_ROLES);
  let line;
  try {
    line = await withTaskTransaction(async (tx) => {
      await lockMaterialProduct(tx, id, session.user);
      const line = await tx.projectMaterial.findUnique({ where: {product:productVisibilityWhere(session.user), id }, include: {
        material: { select: { name: true } }, product: { select: { projectId: true } },
      } });
      if (!line) throw new Error("Строка не найдена");
      if (Number(line.issuedQty) > 0) throw new Error("По строке уже есть выдача со склада — сначала верните материал");
      await tx.projectMaterial.delete({ where: { id } });
  await tx.changeLog.create({ data: {
    actorType: "user", source: "web",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: id,
    action: "delete",
    oldValue: {
      material: line.material.name,
      quantity: Number(line.quantity),
    },
  } });
      return line;
    });
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось удалить потребность" }; }

  await deliverPostCommit("material-norm-delete", id, [{kind:"cache",run:()=>revalidateWarehouse(line.productId, line.product.projectId)}]);
  return { ok: true };
}

// ─── Запрос со склада на проект (списание) ───────────────────────────────

export async function requestMaterial(input: z.input<typeof stockIssueSchema>): Promise<{ok:boolean;error?:string}> {
  const session=await requireRole(WAREHOUSE_MANAGE_ROLES);
  return createStockMovementCore({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},"EXPENSE",input);
}

export async function returnMaterial(input: z.input<typeof stockReturnSchema>): Promise<{ok:boolean;error?:string}> {
  const session=await requireRole(WAREHOUSE_MANAGE_ROLES);
  return createStockMovementCore({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},"RETURN",input);
}
