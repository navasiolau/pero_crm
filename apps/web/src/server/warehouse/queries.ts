import {FIELD_ROLES,OFFICE_ROLES,WAREHOUSE_MONEY_ROLES,hasAnyRole} from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { decimalAtoms, decimalText, materialDebt } from "@/lib/product-quantity";
import { hasFullProjectVisibility, productVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";

// ─── Склад (§12, фаза 6): номенклатура, остатки из движений, потребность ──
// Остатки не хранятся: остаток = Σ INCOME + Σ RETURN − Σ EXPENSE.
// Потребность изделия (ProjectMaterial) создаётся без проверки остатка;
// нехватка вычисляется: debt = quantity − issuedQty, строка «в нехватке»,
// если debt > 0 и остаток < debt. Бейдж проекта — агрегат по его изделиям.

export type MaterialCategoryView = {
  id: string;
  name: string;
  comment: string | null;
  active: boolean;
};

export async function listCategories(): Promise<MaterialCategoryView[]> {
  const categories = await prisma.materialCategory.findMany({
    orderBy: { createdAt: "asc" },
  });
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    comment: category.comment,
    active: category.active,
  }));
}

// Остатки по всем материалам одним groupBy: materialId → количество
async function stockByMaterial(
  materialIds?: string[],
): Promise<Map<string, number>> {
  const grouped = await prisma.stockMovement.groupBy({
    by: ["materialId", "type"],
    where: materialIds ? { materialId: { in: materialIds } } : undefined,
    _sum: { quantity: true },
  });
  const stock = new Map<string, bigint>();
  for (const row of grouped) {
    const sign = row.type === "EXPENSE" ? -1 : 1;
    stock.set(
      row.materialId,
      (stock.get(row.materialId) ?? BigInt(0)) + BigInt(sign) * decimalAtoms(row._sum.quantity ?? 0, 3, 18),
    );
  }
  return new Map([...stock].map(([id, atoms]) => [id, Number(decimalText(atoms, 3))]));
}

// Открытая потребность (долг) по материалам: Σ max(0, quantity − issuedQty)
async function debtByMaterial(actor: VisibilityActor): Promise<Map<string, number>> {
  actor = await resolveVisibilityActor(prisma, actor);
  const lines = await prisma.projectMaterial.findMany({
    where: { product: productVisibilityWhere(actor) },
    select: { materialId: true, quantity: true, issuedQty: true },
  });
  const debt = new Map<string, number>();
  for (const line of lines) {
    const value = materialDebt(line.quantity, line.issuedQty);
    if (value > 0) {
      debt.set(line.materialId, (debt.get(line.materialId) ?? 0) + value);
    }
  }
  return debt;
}

export type MaterialView = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  purchasePrice: number | null; // учётная цена, BYN
  minStock: number | null;
  active: boolean;
  comment: string | null;
  stock: number; // остаток из движений
  shortByProjects: number; // сколько не хватает по всем открытым потребностям
};

export async function listMaterials(actor: VisibilityActor): Promise<MaterialView[]> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  const [materials, stock, debt] = await Promise.all([
    prisma.material.findMany({
      orderBy: { name: "asc" },
      include: { category: { select: { name: true } } },
    }),
    stockByMaterial(),
    debtByMaterial(actor),
  ]);
  return materials.map((material) => {
    const onStock = stock.get(material.id) ?? 0;
    const need = debt.get(material.id) ?? 0;
    return {
      id: material.id,
      name: material.name,
      sku: material.sku,
      unit: material.unit,
      categoryId: material.categoryId,
      categoryName: material.category?.name ?? null,
      purchasePrice:
        !hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES)||material.purchasePrice === null ? null : Number(material.purchasePrice),
      minStock: material.minStock === null ? null : Number(material.minStock),
      active: material.active,
      comment: material.comment,
      stock: onStock,
      shortByProjects: Math.max(0, need - onStock),
    };
  });
}

// Остатки — та же выборка, что listMaterials (страница «Остатки»)
export const listStock = listMaterials;

export type StockMovementView = {
  id: string;
  type: "INCOME" | "EXPENSE" | "RETURN";
  materialId: string;
  materialName: string;
  materialUnit: string;
  quantity: number;
  unitPrice: number | null;
  totalByn: number | null;
  productId: string | null;
  productNumber: string | null;
  comment: string | null;
  createdByName: string | null;
  createdAt: string; // ISO
};

export async function listMovements(actor: VisibilityActor, filter?: {
  materialId?: string;
  productId?: string;
  type?: "INCOME" | "EXPENSE" | "RETURN";
}): Promise<StockMovementView[]> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(prisma, actor);
  const movements = await prisma.stockMovement.findMany({
    where: {
      ...(hasFullProjectVisibility(actor) ? {} : { OR: [{ productId: null }, { product: productVisibilityWhere(actor) }] }),
      materialId: filter?.materialId || undefined,
      productId: filter?.productId || undefined,
      type: filter?.type || undefined,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      material: { select: { name: true, unit: true } },
      product: { select: { number: true } },
    },
  });
  const userIds = [
    ...new Set(movements.map((m) => m.createdById).filter(Boolean)),
  ] as string[];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((user) => [user.id, user.name]));
  return movements.map((movement) => ({
    id: movement.id,
    type: movement.type,
    materialId: movement.materialId,
    materialName: movement.material.name,
    materialUnit: movement.material.unit,
    quantity: Number(movement.quantity),
    unitPrice: !hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES)||movement.unitPrice === null ? null : Number(movement.unitPrice),
    totalByn: !hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES)||movement.totalByn === null ? null : Number(movement.totalByn),
    productId: movement.productId,
    productNumber: movement.product?.number ?? null,
    comment: movement.comment,
    createdByName: movement.createdById
      ? (userName.get(movement.createdById) ?? null)
      : null,
    createdAt: movement.createdAt.toISOString(),
  }));
}

export type ProjectMaterialLineStatus = "FULFILLED" | "AVAILABLE" | "SHORTAGE";

export type ProjectMaterialLine = {
  id: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  unit: string;
  purchasePrice: number | null;
  quantityPerUnit: number;
  quantity: number; // сколько нужно
  issuedQty: number; // сколько уже выдано
  debt: number; // quantity − issuedQty
  available: number; // остаток на складе
  status: ProjectMaterialLineStatus;
  comment: string | null;
};

export type ProjectMaterialsData = {
  lines: ProjectMaterialLine[];
  movements: StockMovementView[];
  materialsTotalByn: number; // Σ EXPENSE − Σ RETURN (для A/D)
  hasShortage: boolean;
};

export async function getProjectMaterials(
  productId: string,
  actor: VisibilityActor,
): Promise<ProjectMaterialsData> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(prisma, actor);
  const [rows, movements] = await Promise.all([
    prisma.projectMaterial.findMany({
      where: { productId, product: productVisibilityWhere(actor) },
      orderBy: { createdAt: "asc" },
      include: {
        material: {
          select: { id: true, name: true, sku: true, unit: true, purchasePrice: true },
        },
      },
    }),
    listMovements(actor, { productId }),
  ]);
  const stock = await stockByMaterial(rows.map((row) => row.materialId));

  let hasShortage = false;
  const lines: ProjectMaterialLine[] = rows.map((row) => {
    const quantity = Number(row.quantity);
    const issuedQty = Number(row.issuedQty);
    const debt = materialDebt(row.quantity, row.issuedQty);
    const available = stock.get(row.materialId) ?? 0;
    const status: ProjectMaterialLineStatus =
      debt <= 0 ? "FULFILLED" : available >= debt ? "AVAILABLE" : "SHORTAGE";
    if (status === "SHORTAGE") hasShortage = true;
    return {
      id: row.id,
      materialId: row.materialId,
      materialName: row.material.name,
      materialSku: row.material.sku,
      unit: row.material.unit,
      purchasePrice:
        !hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES)||row.material.purchasePrice === null
          ? null
          : Number(row.material.purchasePrice),
      quantity,
      quantityPerUnit: Number(row.quantityPerUnit ?? row.quantity),
      issuedQty,
      debt,
      available,
      status,
      comment: row.comment,
    };
  });

  const materialsTotalByn = movements.reduce(
    (sum, movement) =>
      sum +
      (movement.type === "RETURN" ? -1 : 1) * (movement.totalByn ?? 0),
    0,
  );

  return {
    lines,
    movements: movements.filter((movement) => movement.type !== "INCOME"),
    materialsTotalByn: Math.round(materialsTotalByn * 100) / 100,
    hasShortage,
  };
}

// Флаги нехватки для списков изделий: изделие помечается, если у него есть
// строка потребности, которую не покрывает остаток.
export async function listProductShortages(
  productIds: string[],
  actor: VisibilityActor,
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  if(!hasAnyRole(actor.roles,[...OFFICE_ROLES,...FIELD_ROLES]))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(prisma, actor);
  const lines = await prisma.projectMaterial.findMany({
    where: { productId: { in: productIds }, product: productVisibilityWhere(actor) },
    select: {
      productId: true,
      materialId: true,
      quantity: true,
      issuedQty: true,
    },
  });
  if (lines.length === 0) return new Set();
  const stock = await stockByMaterial([
    ...new Set(lines.map((line) => line.materialId)),
  ]);
  const result = new Set<string>();
  for (const line of lines) {
    const debt = Number(line.quantity) - Number(line.issuedQty);
    if (debt > 0 && (stock.get(line.materialId) ?? 0) < debt) {
      result.add(line.productId);
    }
  }
  return result;
}

// Бейдж «Нехватка материалов» для списков проектов (канбан/таблица):
// агрегат по всем изделиям проекта.
export async function listProjectShortages(
  projectIds: string[],
  actor: VisibilityActor,
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  if(!hasAnyRole(actor.roles,[...OFFICE_ROLES,...FIELD_ROLES]))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(prisma, actor);
  const lines = await prisma.projectMaterial.findMany({
    where: { product: { AND: [{ projectId: { in: projectIds } }, productVisibilityWhere(actor)] } },
    select: {
      materialId: true,
      quantity: true,
      issuedQty: true,
      product: { select: { projectId: true } },
    },
  });
  if (lines.length === 0) return new Set();
  const stock = await stockByMaterial([
    ...new Set(lines.map((line) => line.materialId)),
  ]);
  const result = new Set<string>();
  for (const line of lines) {
    const debt = Number(line.quantity) - Number(line.issuedQty);
    if (debt > 0 && (stock.get(line.materialId) ?? 0) < debt) {
      result.add(line.product.projectId);
    }
  }
  return result;
}

// Материалы для диалогов (SearchableSelect): активные, с остатком в hint
export type MaterialOption = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  purchasePrice: number | null;
  stock: number;
};

export async function listMaterialOptions(actor: VisibilityActor): Promise<MaterialOption[]> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  const materials = await listMaterials(actor);
  return materials
    .filter((material) => material.active)
    .map((material) => ({
      id: material.id,
      name: material.name,
      sku: material.sku,
      unit: material.unit,
      purchasePrice: material.purchasePrice,
      stock: material.stock,
    }));
}
