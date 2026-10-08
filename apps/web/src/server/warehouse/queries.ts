import type { Prisma } from "@prisma/client";
import {activeStockMovementWhere} from './active-records';
import { summarizeProjectExpenses } from "@/server/finance/project-expense-facts";
import type { StockMovementView, ProjectMaterialLineStatus, ProjectMaterialLine, ProjectMaterialsData, MaterialOption, WarehouseReturnSource } from "./contracts";
export type { StockMovementView, ProjectMaterialLineStatus, ProjectMaterialLine, ProjectMaterialsData, MaterialOption } from "./contracts";
import {FIELD_ROLES,OFFICE_ROLES,WAREHOUSE_MONEY_ROLES,hasAnyRole} from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { warehouseReadPositions, averagePrice } from './accounting';
import {loadMovementReportDocuments} from './report-documents';
import { materialDebt,decimalAtoms,decimalText } from "@/lib/product-quantity";
import { hasFullProjectVisibility, productVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";

// ─── Склад: текущий баланс, неизменённая история и потребность ──
// После операторского запуска количество и стоимость берутся из WarehouseBalance.
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

// Единый текущий остаток: materialId → количество.
async function stockByMaterial(
  materialIds?: string[],
): Promise<Map<string, number>> {
  const data=await warehouseReadPositions(prisma,materialIds);
  return new Map([...data.positions].map(([id,position])=>[id,Number(position.quantity)]));
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
  warehouseReady: boolean;
  shortByProjects: number; // сколько не хватает по всем открытым потребностям
};

export async function listMaterials(actor: VisibilityActor): Promise<MaterialView[]> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  const [materials, stock, debt] = await Promise.all([
    prisma.material.findMany({
      orderBy: { name: "asc" },
      include: { category: { select: { name: true } } },
    }),
    warehouseReadPositions(prisma),
    debtByMaterial(actor),
  ]);
  return materials.map((material) => {
    const position=stock.positions.get(material.id)??{quantity:'0',value:'0'};
    const onStock = Number(position.quantity);
    const need = debt.get(material.id) ?? 0;
    return {
      id: material.id,
      name: material.name,
      sku: material.sku,
      unit: material.unit,
      categoryId: material.categoryId,
      categoryName: material.category?.name ?? null,
      purchasePrice:
        !hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES)?null:stock.current?Number(averagePrice(position)):material.purchasePrice===null?null:Number(material.purchasePrice),
      minStock: material.minStock === null ? null : Number(material.minStock),
      active: material.active,
      comment: material.comment,
      stock: onStock,
      warehouseReady: stock.ready,
      shortByProjects: Math.max(0, need - onStock),
    };
  });
}

// Остатки — та же выборка, что listMaterials (страница «Остатки»)
export const listStock = listMaterials;

export async function listMovements(actor: VisibilityActor, filter?: {
  materialId?: string;
  productId?: string;
  type?: "INCOME" | "EXPENSE" | "RETURN";
}, database: Prisma.TransactionClient = prisma): Promise<StockMovementView[]> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(database, actor);
  return loadMovements(actor,filter,database);
}
async function loadMovements(actor: VisibilityActor, filter: {materialId?:string;productId?:string;type?:"INCOME"|"EXPENSE"|"RETURN"}|undefined, database: Prisma.TransactionClient): Promise<StockMovementView[]> {
  const movements = await database.stockMovement.findMany({
    where: {
      ...activeStockMovementWhere,
      ...(hasFullProjectVisibility(actor) ? {} : { OR: [{ productId: null }, { product: productVisibilityWhere(actor) }] }),
      materialId: filter?.materialId || undefined,
      productId: filter?.productId || undefined,
      type: filter?.type || undefined,
    },
    orderBy: [{ createdAt: "desc" },{id:"desc"}],
    take: 500,
    include: {
      material: { select: { name: true, unit: true } },
      product: { select: { number: true } },
    },
  });
  const userIds = [
    ...new Set(movements.map((m) => m.createdById).filter(Boolean)),
  ] as string[];
  const [users,documents] = await Promise.all([database.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  }),loadMovementReportDocuments(actor,movements.map(movement=>movement.id),database)]);
  const userName = new Map(users.map((user) => [user.id, user.name]));
  return movements.map((movement) => ({
    id: movement.id,
    type: movement.type,
    receiptKind: movement.receiptKind,
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
    reportDocument: documents.get(movement.id)??null,
  }));
}

export async function getProjectMaterials(
  productId: string,
  actor: VisibilityActor,
  database: Prisma.TransactionClient = prisma,
): Promise<ProjectMaterialsData> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(database, actor);
  const [rows, movements] = await Promise.all([
    database.projectMaterial.findMany({
      where: { productId, product: productVisibilityWhere(actor) },
      orderBy: { createdAt: "asc" },
      include: {
        material: {
          select: { id: true, name: true, sku: true, unit: true, purchasePrice: true },
        },
      },
    }),
    loadMovements(actor, { productId }, database),
  ]);
  const stock = await warehouseReadPositions(database,rows.map((row) => row.materialId));
  const showMoney=hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES);
  const [issued,allCosts]=await Promise.all([
    stock.current&&stock.runId ? database.warehouseMovementValuation.findMany({
      where:{runId:stock.runId,movement:{...activeStockMovementWhere,productId,product:productVisibilityWhere(actor),type:"EXPENSE"}},
      include:{movement:{select:{materialId:true,createdAt:true,material:{select:{name:true,unit:true}}}}}
    }) : Promise.resolve([]),
    showMoney ? database.stockMovement.findMany({where:{...activeStockMovementWhere,productId,product:productVisibilityWhere(actor),type:{in:["EXPENSE","RETURN"]}},select:{type:true,totalByn:true}}) : Promise.resolve([]),
  ]);
  const returnSources:WarehouseReturnSource[]=issued.map(item=>({id:item.movementId,materialId:item.movement.materialId,
    materialName:item.movement.material.name,unit:item.movement.material.unit,createdAt:item.movement.createdAt.toISOString(),
    quantity:item.quantity.minus(item.returnedQuantity).toNumber(),unitPrice:showMoney?item.unitCost.toString():null})).filter(item=>item.quantity>0);
  const sourcesById=new Map(returnSources.map(item=>[item.id,item]));
  let hasShortage = false;
  const lines: ProjectMaterialLine[] = rows.map((row) => {
    const quantity = Number(row.quantity);
    const issuedQty = Number(row.issuedQty);
    const debt = materialDebt(row.quantity, row.issuedQty);
    const position=stock.positions.get(row.materialId)??{quantity:'0',value:'0'};
    const available = Number(position.quantity);
    const sources=returnSources.filter(item=>item.materialId===row.materialId);
    const legacyQuantity=decimalAtoms(row.issuedQty,3,12)-sources.reduce((sum,item)=>sum+decimalAtoms(item.quantity,3,12),BigInt(0));
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
        !hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES)?null:stock.current?Number(averagePrice(position)):row.material.purchasePrice===null?null:Number(row.material.purchasePrice),
      quantity,
      quantityPerUnit: Number(row.quantityPerUnit ?? row.quantity),
      issuedQty,
      debt,
      available,
      status,
      comment: row.comment,
      warehouseReady: stock.ready,
      returnSources:sources,
      legacyReturnQuantity:Number(decimalText(legacyQuantity>BigInt(0)?legacyQuantity:BigInt(0),3)),
    };
  });

  const materialsTotalByn = showMoney ? summarizeProjectExpenses({payments:[],stockMovements:allCosts}).expensesTotal : null;

  return {
    lines,
    movements: movements.filter((movement) => movement.type !== "INCOME").map(movement=>({...movement,returnableQuantity:sourcesById.get(movement.id)?.quantity??null})),
    materialsTotalByn,
    returnSources, warehouseReady:stock.ready,
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

// One catalog read supplies both the planned need and direct issue pickers.
export async function listProductMaterialOptions(actor:VisibilityActor) {
  const materials=await listMaterials(actor);
  const option=(material:MaterialView):MaterialOption=>({id:material.id,name:material.name,sku:material.sku,unit:material.unit,purchasePrice:material.purchasePrice,stock:material.stock});
  return {plan:materials.filter(material=>material.active).map(option),
    issue:materials.filter(material=>material.stock>0).map(material=>({...option(material),name:material.active?material.name:material.name+" (архив)"}))};
}
