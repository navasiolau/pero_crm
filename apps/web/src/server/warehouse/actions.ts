"use server";

import { writeChangeLogInTransaction } from "@/server/changelog/writer";


import { z } from "zod";
import { revalidatePath } from "next/cache";
import { deliverPostCommit } from "@/server/operations/post-commit";


import { journalProductContext, materialJournalSnapshot } from "@/server/finance/journal";


import { revalidateWarehouse } from "./revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { addMaterialNorm, updateMaterialNorm, deleteMaterialNorm } from "./norm-core";
import { stockInventoryReceiptSchema, stockIssueSchema, stockReturnSchema } from "./contracts";
import { withWarehouseWrite } from "./accounting";
import { createStockMovementCore } from "./movement-service";
import {MANAGER_ROLES,WAREHOUSE_MANAGE_ROLES} from "@/lib/roles";
import { requireRole } from "@/server/require-role";
import { materialSchema, type MaterialInput, type MaterialCreateResult } from "./material-contracts";
import { createMaterialInTransaction, requireMaterialUnit, materialCatalogError } from "./material-core";
import { catalogCommand, categorySnapshot } from "./catalog-reversal-contract";

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
  await withWarehouseWrite(async tx => {
  const category = await tx.materialCategory.create({
    data: {
      name: parsed.data.name,
      comment: parsed.data.comment?.trim() || null,
    },
  });
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "materialCategory",
    entityId: category.id,
    action: "create",
    reversal: await catalogCommand(tx, { entity: "materialCategory", before: null, after: category }),
    newValue: { name: category.name },
  }, { entity: { label: `Категория материалов ${category.name}` }, contexts: [], before: null,
    after: { name: category.name, comment: category.comment, active: category.active } });
  });
  await revalidateWarehouse();
  return { ok: true };
}

export async function updateMaterialCategory(id: string, input: z.input<typeof categorySchema>) {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const result = await withWarehouseWrite(async tx => {
    await tx.$queryRaw`SELECT id FROM "MaterialCategory" WHERE id=${id} FOR UPDATE`;
    const before = await tx.materialCategory.findUnique({ where: { id } });
    if (!before) return { ok: false as const, error: "Категория не найдена" };
    const data = { name: parsed.data.name, comment: parsed.data.comment?.trim() || null };
    if (data.name === before.name && data.comment === before.comment) return { ok: true as const };
    const after = await tx.materialCategory.update({ where: { id }, data });
    await writeChangeLogInTransaction(tx, {
      actorType: "user", actorId: session.user.id, actorName: session.user.name,
      entity: "materialCategory", entityId: id, action: "update",
      oldValue: categorySnapshot(before), newValue: categorySnapshot(after),
      reversal: await catalogCommand(tx, { entity: "materialCategory", before, after }),
    }, { entity: { label: `Категория материалов ${after.name}` }, contexts: [] });
    return { ok: true as const };
  });
  if (result.ok) await revalidateWarehouse();
  return result;
}

export async function toggleMaterialCategory(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const result = await withWarehouseWrite(async tx => {
  await tx.$queryRaw`SELECT id FROM "MaterialCategory" WHERE id=${id} FOR UPDATE`;
  const category = await tx.materialCategory.findUnique({ where: { id } });
  if (!category) return { ok: false as const, error: "Категория не найдена" };
  const after = await tx.materialCategory.update({
    where: { id },
    data: { active: !category.active },
  });
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "materialCategory",
    entityId: id,
    action: "update",
    reversal: await catalogCommand(tx, { entity: "materialCategory", before: category, after }),
    field: "active",
    oldValue: category.active,
    newValue: !category.active,
  }, { entity: { label: `Категория материалов ${category.name}` }, contexts: [] });
  return { ok: true as const };
  });
  if (!result.ok) return result;
  await revalidateWarehouse();
  return { ok: true };
}

// ─── Номенклатура ─────────────────────────────────────────────────────────

export async function addMaterial(input: MaterialInput): Promise<MaterialCreateResult> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  try {
    const result = await withWarehouseWrite(tx => createMaterialInTransaction({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input, tx));
    if (result.ok) { await revalidateWarehouse(); revalidatePath("/settings/warehouse-units"); }
    return result;
  } catch (error) { return { ok: false, error: materialCatalogError(error) }; }
}

export async function updateMaterial(id: string, input: z.input<typeof materialSchema>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data = parsed.data;
  try {
    const result = await withWarehouseWrite(async tx => {
      await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${id} FOR UPDATE`;
      const material = await tx.material.findUnique({ where: { id }, include: { measurementUnit: { select: { name: true } }, category: { select: { name: true } } } });
      if (!material) return { ok: false as const, error: "Материал не найден" };
      await requireMaterialUnit(tx, data.unitId);
      if (data.categoryId && data.categoryId !== material.categoryId) {
        await tx.$queryRaw`SELECT id FROM "MaterialCategory" WHERE id=${data.categoryId} FOR SHARE`;
        if (!await tx.materialCategory.findUnique({ where: { id: data.categoryId, active: true }, select: { id: true } }))
          return { ok: false as const, error: "Категория материалов больше недоступна" };
      }
      const updated = await tx.material.update({ where: { id }, data: {
        name: data.name, sku: data.sku?.trim() || null, unitId: data.unitId,
        categoryId: data.categoryId || null, minStock: data.minStock ?? null, comment: data.comment?.trim() || null,
      }, include: { measurementUnit: { select: { name: true } }, category: { select: { name: true } } } });
      await writeChangeLogInTransaction(tx, { actorType: "user", actorId: session.user.id, actorName: session.user.name ?? undefined,
        entity: "material", entityId: id, action: "update",
        ...(material.warehouseCatalogRevision !== updated.warehouseCatalogRevision && {
          reversal: await catalogCommand(tx, { entity: "material", before: material, after: updated }),
        }),
        oldValue: { name: material.name, sku: material.sku, unitId: material.unitId, unit: material.measurementUnit.name },
        newValue: { name: updated.name, sku: updated.sku, unitId: updated.unitId, unit: updated.measurementUnit.name },
      }, { entity: { label: `Материал ${updated.name}`, href: "/warehouse/materials" }, contexts: [],
        links: [{type:"materialUnit",id:material.unitId,label:material.measurementUnit.name},{type:"materialUnit",id:updated.unitId,label:updated.measurementUnit.name},
          ...(material.categoryId&&material.category?[{type:"materialCategory",id:material.categoryId,label:material.category.name}]:[]),
          ...(updated.categoryId&&updated.category?[{type:"materialCategory",id:updated.categoryId,label:updated.category.name}]:[])],
        before: materialJournalSnapshot(material), after: materialJournalSnapshot(updated) });
      return { ok: true as const };
    });
    if (!result.ok) return result;
  } catch (error) { return { ok: false, error: materialCatalogError(error) }; }
  await revalidateWarehouse();
  revalidatePath("/settings/warehouse-units");
  return { ok: true };
}

export async function toggleMaterial(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const result = await withWarehouseWrite(async tx => {
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${id} FOR UPDATE`;
  const material = await tx.material.findUnique({ where: { id } });
  if (!material) return { ok: false as const, error: "Материал не найден" };
  const after = await tx.material.update({
    where: { id },
    data: { active: !material.active },
  });
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "material",
    entityId: id,
    action: "update",
    reversal: await catalogCommand(tx, { entity: "material", before: material, after }),
    field: "active",
    oldValue: material.active,
    newValue: !material.active,
  }, { entity: { label: `Материал ${material.name}`, href: "/warehouse/materials" }, contexts: [] });
  return { ok: true as const };
  });
  if (!result.ok) return result;
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
    const { line, product, material, previous } = result;
  await writeChangeLogInTransaction(tx, {
    actorType: "user", source: "web",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: line.id,
    action: previous && !previous.deletedAt ? "update" : "create",
    reversal: await catalogCommand(tx, { entity: "projectMaterial", before: previous, after: line }),
    newValue: {
      product: product.number,
      material: material.name,
      quantity: line.quantity.toString(),
      quantityPerUnit: line.quantityPerUnit?.toString() ?? null,
    },
  }, {entity:{label:`Потребность ${product.number}: ${material.name}`},contexts:[journalProductContext(product)],
    before:previous?{material:material.name,quantity:previous.quantity.toString(),quantityPerUnit:previous.quantityPerUnit?.toString()??null,issuedQty:previous.issuedQty.toString(),comment:previous.comment}:null,
    after:{material:material.name,quantity:line.quantity.toString(),quantityPerUnit:line.quantityPerUnit?.toString()??null,issuedQty:line.issuedQty.toString(),comment:line.comment}});
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
    const { line, updated, quantity, quantityPerUnit } = result;
  await writeChangeLogInTransaction(tx, {
    actorType: "user", source: "web",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: line.id,
    action: "update",
    ...(line.warehouseCatalogRevision !== updated.warehouseCatalogRevision && {
      reversal: await catalogCommand(tx, { entity: "projectMaterial", before: line, after: updated }),
    }),
    field: "quantity",
    oldValue: Number(line.quantity),
    newValue: { quantity, quantityPerUnit },
  }, {entity:{label:`Потребность ${line.product.number}: ${line.material.name}`},contexts:[journalProductContext({id:line.productId,number:line.product.number})],
    before:{quantity:line.quantity.toString(),quantityPerUnit:line.quantityPerUnit?.toString()??null,comment:line.comment},
    after:{quantity,quantityPerUnit,comment:parsed.data.comment?.trim()||null}});
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
      const { line, after, deletedAt } = await deleteMaterialNorm(tx, id, session.user);
  await writeChangeLogInTransaction(tx, {
    actorType: "user", source: "web",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: id,
    action: "delete",
    reversal: await catalogCommand(tx, { entity: "projectMaterial", before: line, after }),
    oldValue: {
      material: line.material.name,
      quantity: Number(line.quantity),
    },
  }, {entity:{label:`Потребность ${line.product.number}: ${line.material.name}`},contexts:[journalProductContext({id:line.productId,number:line.product.number})],
    before:{materialId:line.materialId,material:line.material.name,quantity:line.quantity.toString(),quantityPerUnit:line.quantityPerUnit?.toString()??null,issuedQty:line.issuedQty.toString(),comment:line.comment},after:{deletedAt}});
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
