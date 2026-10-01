"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { formatAmount, formatQty } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { addMaterialNorm, updateMaterialNorm, lockMaterialProduct } from "./norm-core";
import { decimalAtoms, decimalText, materialDebt } from "@/lib/product-quantity";
import { requireRole } from "@/server/require-role";

// Склад (§12, фаза 6). Правки — админ/директор/менеджер; просмотр — офисные
// роли (разграничение на страницах). Цены — BYN; EXPENSE/RETURN несут
// снимок цены (unitPrice/totalByn) и идут в экономику проекта (§11).

const WAREHOUSE_MANAGERS = ["ADMIN", "DIRECTOR", "MANAGER"] as const;

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Категории ────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1, "Укажите название"),
  comment: z.string().optional(),
});

export async function addMaterialCategory(
  input: z.input<typeof categorySchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const category = await prisma.materialCategory.create({
    data: {
      name: parsed.data.name,
      comment: parsed.data.comment?.trim() || null,
    },
  });
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
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const category = await prisma.materialCategory.findUnique({ where: { id } });
  if (!category) return { ok: false, error: "Категория не найдена" };
  await prisma.materialCategory.update({
    where: { id },
    data: { active: !category.active },
  });
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
  purchasePrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  minStock: z.number().nonnegative("Мин. остаток не может быть отрицательным").optional(),
  comment: z.string().optional(),
});

export async function addMaterial(
  input: z.input<typeof materialSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
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
  const material = await prisma.material.create({
    data: {
      name: data.name,
      sku: data.sku?.trim() || null,
      unit: data.unit,
      categoryId: data.categoryId || null,
      purchasePrice: data.purchasePrice ?? null,
      minStock: data.minStock ?? null,
      comment: data.comment?.trim() || null,
    },
  });
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
      purchasePrice: data.purchasePrice ?? null,
    },
  });
  await revalidateWarehouse();
  return { ok: true };
}

export async function updateMaterial(
  id: string,
  input: z.input<typeof materialSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const material = await prisma.material.findUnique({ where: { id } });
  if (!material) return { ok: false, error: "Материал не найден" };
  const data = parsed.data;
  await prisma.material.update({
    where: { id },
    data: {
      name: data.name,
      sku: data.sku?.trim() || null,
      unit: data.unit,
      categoryId: data.categoryId || null,
      purchasePrice: data.purchasePrice ?? null,
      minStock: data.minStock ?? null,
      comment: data.comment?.trim() || null,
    },
  });
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
      purchasePrice: material.purchasePrice === null ? null : Number(material.purchasePrice),
    },
    newValue: {
      name: data.name,
      sku: data.sku?.trim() || null,
      unit: data.unit,
      purchasePrice: data.purchasePrice ?? null,
    },
  });
  await revalidateWarehouse();
  return { ok: true };
}

export async function toggleMaterial(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const material = await prisma.material.findUnique({ where: { id } });
  if (!material) return { ok: false, error: "Материал не найден" };
  await prisma.material.update({
    where: { id },
    data: { active: !material.active },
  });
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

const incomeSchema = z.object({
  materialId: z.string().min(1, "Выберите материал"),
  quantity: z.number().positive("Количество должно быть больше нуля"),
  unitPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  comment: z.string().optional(),
});

export async function addStockIncome(
  input: z.input<typeof incomeSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const parsed = incomeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  const material = await prisma.material.findUnique({
    where: { id: data.materialId },
  });
  if (!material || !material.active) {
    return { ok: false, error: "Материал не найден" };
  }
  const unitPrice = data.unitPrice ?? null;
  const movement = await prisma.stockMovement.create({
    data: {
      materialId: material.id,
      type: "INCOME",
      quantity: data.quantity,
      unitPrice,
      totalByn: unitPrice === null ? null : round2(data.quantity * unitPrice),
      comment: data.comment?.trim() || null,
      createdById: session.user.id,
    },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "stockMovement",
    entityId: movement.id,
    action: "create",
    newValue: {
      type: "INCOME",
      material: material.name,
      quantity: data.quantity,
      unitPrice,
    },
  });
  await emitDomainEvent(
    "stock.movement.created",
    {
      movementId: movement.id,
      type: "INCOME",
      materialId: material.id,
      quantity: data.quantity,
    },
    session.user.id,
  );
  await revalidateWarehouse();
  return { ok: true };
}

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
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
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
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
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
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  let line;
  try {
    line = await withTaskTransaction(async (tx) => {
      await lockMaterialProduct(tx, id);
      const line = await tx.projectMaterial.findUnique({ where: { id }, include: {
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

const requestSchema = z.object({
  projectMaterialId: z.string().min(1),
  quantity: z.number().positive("Количество должно быть больше нуля"),
  unitPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  comment: z.string().optional(),
});

export async function requestMaterial(
  input: z.input<typeof requestSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockMaterialProduct(tx, data.projectMaterialId);
      const line = await tx.projectMaterial.findUnique({
        where: { id: data.projectMaterialId },
        include: {
          material: { select: { id: true, name: true, unit: true, purchasePrice: true } },
          product: { select: { id: true, number: true, projectId: true } },
        },
      });
      if (!line) throw new Error("Строка потребности не найдена");

      const debt = materialDebt(line.quantity, line.issuedQty);
      decimalAtoms(data.quantity, 3, 12);
      if (data.quantity > debt) {
        throw new Error(`Осталось выдать по строке ${formatQty(debt)} ${line.material.unit}`);
      }

      // Остаток внутри транзакции: Σ INCOME + Σ RETURN − Σ EXPENSE
      const grouped = await tx.stockMovement.groupBy({
        by: ["type"],
        where: { materialId: line.materialId },
        _sum: { quantity: true },
      });
      let stockAtoms = BigInt(0);
      for (const row of grouped) {
        stockAtoms += BigInt(row.type === "EXPENSE" ? -1 : 1) * decimalAtoms(row._sum.quantity ?? 0, 3, 18);
      }
      if (decimalAtoms(data.quantity, 3, 12) > stockAtoms) {
        const stock = decimalText(stockAtoms, 3);
        throw new Error(
          `Недостаточно на складе: доступно ${formatQty(stock)} ${line.material.unit}`,
        );
      }

      const unitPrice =
        data.unitPrice ??
        (line.material.purchasePrice === null
          ? null
          : Number(line.material.purchasePrice));
      const movement = await tx.stockMovement.create({
        data: {
          materialId: line.materialId,
          type: "EXPENSE",
          quantity: data.quantity,
          unitPrice,
          totalByn: unitPrice === null ? null : round2(data.quantity * unitPrice),
          productId: line.productId,
          projectMaterialId: line.id,
          comment: data.comment?.trim() || null,
          createdById: session.user.id,
        },
      });
      await tx.projectMaterial.update({
        where: { id: line.id },
        data: { issuedQty: { increment: data.quantity } },
      });
      return { movement, line, unitPrice };
    }, TX_OPTIONS);

    const { movement, line, unitPrice } = result;
    await writeChangeLog({
      actorType: "user",
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      entity: "stockMovement",
      entityId: movement.id,
      action: "create",
      newValue: {
        type: "EXPENSE",
        product: line.product.number,
        material: line.material.name,
        quantity: data.quantity,
        unitPrice,
      },
    });
    await emitDomainEvent(
      "stock.movement.created",
      {
        movementId: movement.id,
        type: "EXPENSE",
        materialId: line.materialId,
        productId: line.productId,
        quantity: data.quantity,
        totalByn: movement.totalByn === null ? null : Number(movement.totalByn),
      },
      session.user.id,
    );
    await notifyOrg({
      type: "stock.expense",
      title: `Списание: ${line.material.name} × ${formatQty(data.quantity)} · ${line.product.number}`,
      body:
        unitPrice === null
          ? undefined
          : `Сумма: ${formatAmount(round2(data.quantity * unitPrice), "BYN")}`,
      link: `/products/${line.product.number}`,
      exceptUserId: session.user.id,
    });
    await revalidateWarehouse(line.productId, line.product.projectId);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Ошибка списания",
    };
  }
}

// ─── Возврат с проекта на склад ──────────────────────────────────────────

const returnSchema = z.object({
  projectMaterialId: z.string().min(1),
  quantity: z.number().positive("Количество должно быть больше нуля"),
  unitPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  comment: z.string().optional(),
});

export async function returnMaterial(
  input: z.input<typeof returnSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole([...WAREHOUSE_MANAGERS]);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  try {
    const { movement, line } = await prisma.$transaction(async (tx) => {
      await lockMaterialProduct(tx, data.projectMaterialId);
      const line = await tx.projectMaterial.findUnique({
        where: { id: data.projectMaterialId },
        include: {
          material: { select: { id: true, name: true, unit: true, purchasePrice: true } },
          product: { select: { id: true, number: true, projectId: true } },
        },
      });
      if (!line) throw new Error("Строка потребности не найдена");
      const issuedQty = Number(line.issuedQty);
      if (data.quantity > issuedQty) {
        throw new Error(
          `Нельзя вернуть больше выданного (${formatQty(issuedQty)} ${line.material.unit})`,
        );
      }
      const unitPrice =
        data.unitPrice ??
        (line.material.purchasePrice === null
          ? null
          : Number(line.material.purchasePrice));
      const movement = await tx.stockMovement.create({
        data: {
          materialId: line.materialId,
          type: "RETURN",
          quantity: data.quantity,
          unitPrice,
          totalByn: unitPrice === null ? null : round2(data.quantity * unitPrice),
          productId: line.productId,
          projectMaterialId: line.id,
          comment: data.comment?.trim() || null,
          createdById: session.user.id,
        },
      });
      await tx.projectMaterial.update({
        where: { id: line.id },
        data: { issuedQty: { decrement: data.quantity } },
      });
      return { movement, line };
    }, TX_OPTIONS);

    await writeChangeLog({
      actorType: "user",
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      entity: "stockMovement",
      entityId: movement.id,
      action: "create",
      newValue: {
        type: "RETURN",
        product: line.product.number,
        material: line.material.name,
        quantity: data.quantity,
      },
    });
    await emitDomainEvent(
      "stock.movement.created",
      {
        movementId: movement.id,
        type: "RETURN",
        materialId: line.materialId,
        productId: line.productId,
        quantity: data.quantity,
      },
      session.user.id,
    );
    await revalidateWarehouse(line.productId, line.product.projectId);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Ошибка возврата",
    };
  }
}
