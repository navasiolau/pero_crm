"use server";
import {liveProductWhere} from "@/server/access/live-entities";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { formatQty } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { addMaterialNorm, updateMaterialNorm, lockMaterialProduct } from "./norm-core";
import { stockInventoryReceiptSchema, stockIssueSchema, stockReturnSchema } from "./contracts";
import { warehouseMove, withWarehouseWrite } from "./accounting";
import {MANAGER_ROLES,WAREHOUSE_MANAGE_ROLES} from "@/lib/roles";
import { requireRole } from "@/server/require-role";

// Склад (§12, фаза 6). Правки — админ/директор/менеджер; просмотр — офисные
// роли (разграничение на страницах). Цены — BYN; EXPENSE/RETURN несут
// снимок цены (unitPrice/totalByn) и идут в экономику проекта (§11).



// Опции интерактивных транзакций списания/возврата: дефолты Prisma
// (maxWait 2 с / timeout 5 с) на e2e ловили P2028 «Unable to start
// a transaction» при прогретом пуле соединений
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

async function revalidateWarehouse(productId?: string | null, projectId?: string | null) {
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/stock");
  revalidatePath("/warehouse/items");
  revalidatePath("/warehouse/movements");
  revalidatePath("/projects"); // бейдж нехватки на канбане/в таблице
  revalidatePath("/products");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  await revalidateProductPaths(productId);
}

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
  unit: z.string().trim().min(1, "Укажите единицу"),
  categoryId: z.string().optional(),
  minStock: z.number().nonnegative("Мин. остаток не может быть отрицательным").optional(),
  comment: z.string().optional(),
}).strict();

export async function addMaterial(
  input: z.input<typeof materialSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  if (data.categoryId) {
    const category = await prisma.materialCategory.findUnique({
      where: { id: data.categoryId },
    });
    if (!category || !category.active) {
      return { ok: false, error: "Категория не найдена" };
    }
  }
  const material = await withWarehouseWrite((tx) => tx.material.create({
    data: {
      name: data.name,
      sku: data.sku?.trim() || null,
      unit: data.unit,
      categoryId: data.categoryId || null,
      purchasePrice: 0,
      minStock: data.minStock ?? null,
      comment: data.comment?.trim() || null,
    },
  }));
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "material",
    entityId: material.id,
    action: "create",
    newValue: {
      name: material.name,
      sku: material.sku,
      unit: material.unit,
      purchasePrice: 0,
    },
  });
  await revalidateWarehouse();
  return { ok: true };
}

export async function updateMaterial(
  id: string,
  input: z.input<typeof materialSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const material = await prisma.material.findUnique({ where: { id } });
  if (!material) return { ok: false, error: "Материал не найден" };
  const data = parsed.data;
  await withWarehouseWrite((tx) => tx.material.update({
    where: { id },
    data: {
      name: data.name,
      sku: data.sku?.trim() || null,
      unit: data.unit,
      categoryId: data.categoryId || null,
      minStock: data.minStock ?? null,
      comment: data.comment?.trim() || null,
    },
  }));
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "material",
    entityId: id,
    action: "update",
    oldValue: {
      name: material.name,
      sku: material.sku,
      unit: material.unit,
    },
    newValue: {
      name: data.name,
      sku: data.sku?.trim() || null,
      unit: data.unit,
    },
  });
  await revalidateWarehouse();
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
  const parsed=stockInventoryReceiptSchema.safeParse(input);
  if(!parsed.success)return {ok:false,error:parsed.error.issues[0]?.message??"Укажите положительную цену"};
  return saveWarehouseMovement(session.user,{...parsed.data,kind:"INCOME"});
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
  try { mutation = await withTaskTransaction((tx) => addMaterialNorm(tx, data, session.user.id)); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось добавить материал" }; }
  const { line, product, material } = mutation;
  await writeChangeLog({
    actorType: "user",
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
  });
  await revalidateWarehouse(product.id, product.projectId);
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
  try { mutation = await withTaskTransaction((tx) => updateMaterialNorm(tx, parsed.data)); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить материал" }; }
  const { line, quantity, quantityPerUnit } = mutation;
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: line.id,
    action: "update",
    field: "quantity",
    oldValue: Number(line.quantity),
    newValue: { quantity, quantityPerUnit },
  });
  await revalidateWarehouse(line.productId, line.product.projectId);
  return { ok: true };
}

export async function deleteProjectMaterial(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(MANAGER_ROLES);
  let line;
  try {
    line = await withTaskTransaction(async (tx) => {
      await lockMaterialProduct(tx, id);
      const line = await tx.projectMaterial.findUnique({ where: {product:liveProductWhere, id }, include: {
        material: { select: { name: true } }, product: { select: { projectId: true } },
      } });
      if (!line) throw new Error("Строка не найдена");
      if (Number(line.issuedQty) > 0) throw new Error("По строке уже есть выдача со склада — сначала верните материал");
      await tx.projectMaterial.delete({ where: { id } });
      return line;
    });
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось удалить потребность" }; }
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "projectMaterial",
    entityId: id,
    action: "delete",
    oldValue: {
      material: line.material.name,
      quantity: Number(line.quantity),
    },
  });
  await revalidateWarehouse(line.productId, line.product.projectId);
  return { ok: true };
}

// ─── Запрос со склада на проект (списание) ───────────────────────────────

export async function requestMaterial(input: z.input<typeof stockIssueSchema>): Promise<{ok:boolean;error?:string}> {
  const session=await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed=stockIssueSchema.safeParse(input);
  if(!parsed.success)return {ok:false,error:"Укажите количество; цена выдачи рассчитывается автоматически"};
  return saveWarehouseMovement(session.user,{...parsed.data,kind:"EXPENSE"});
}

export async function returnMaterial(input: z.input<typeof stockReturnSchema>): Promise<{ok:boolean;error?:string}> {
  const session=await requireRole(WAREHOUSE_MANAGE_ROLES);
  const parsed=stockReturnSchema.safeParse(input);
  if(!parsed.success)return {ok:false,error:parsed.error.issues[0]?.message??"Укажите источник возврата"};
  return saveWarehouseMovement(session.user,{...parsed.data,kind:"RETURN"});
}

async function saveWarehouseMovement(actor: {id:string;name?:string|null;roles:import("@prisma/client").Role[]}, input: import("./accounting").WarehouseMovementInput): Promise<{ok:boolean;error?:string}> {
  let result;
  try {
    result=await prisma.$transaction(tx=>warehouseMove(tx,actor,input),TX_OPTIONS);
  } catch(error){return {ok:false,error:error instanceof Error?error.message:"Не удалось сохранить складское движение"};}
  if(!result.repeated){
    await dispatchEvent(result.eventId!).catch(()=>console.error('[warehouse] Складское событие осталось в очереди доставки'));
    if(input.kind==="EXPENSE")await notifyOrg({type:"stock.expense",title:`Списание: ${result.material!.name} × ${formatQty(input.quantity)} · ${result.line!.product.number}`,link:`/products/${result.line!.productId}`,exceptUserId:actor.id}).catch(()=>console.error('[warehouse] Не удалось отправить уведомление о выдаче'));
  }
  await revalidateWarehouse(result.movement.productId,result.line?.product.projectId);
  return {ok:true};
}
