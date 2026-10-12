import type {Prisma} from "@prisma/client";
import {OFFICE_ROLES,WAREHOUSE_MONEY_ROLES,hasAnyRole} from "../../src/lib/roles";
import {canViewProductDrafts} from "../../src/lib/product-drafts";
import {hasFullProjectVisibility,productVisibilityWhere,resolveVisibilityActor,type VisibilityActor} from "../../src/server/access/visibility";
import {materialDebt,decimalAtoms,decimalText} from "../../src/lib/product-quantity";
import {summarizeProjectExpenses} from "../../src/server/finance/project-expense-facts";
import {activeStockMovementWhere} from "../../src/server/warehouse/active-records";
import {warehouseReadPositions,averagePrice} from "../../src/server/warehouse/accounting";
import {loadMovementReportDocuments} from "../../src/server/warehouse/report-documents";
import type {StockMovementView,ProjectMaterialLine,ProjectMaterialLineStatus,ProjectMaterialsData,WarehouseReturnSource} from "../../src/server/warehouse/contracts";
// Frozen cd38 source SHA25624a428a52659afa54596d5b03df9c5549f8be2ed7d0ffb3e67244da4b94a532d.
// Единый независимый old reader для unit/native. Database всегда explicit; logic/grants/DTO не обновлять под новый reader.
async function frozenLoadMovements(actor: VisibilityActor, filter: {materialId?:string;productId?:string;type?:"INCOME"|"EXPENSE"|"RETURN"}|undefined, database: Prisma.TransactionClient): Promise<StockMovementView[]> {
  const movements = await database.stockMovement.findMany({
    where: {
      ...activeStockMovementWhere,
      ...(hasFullProjectVisibility(actor) && canViewProductDrafts(actor.roles) ? {} : { OR: [{ productId: null }, { product: productVisibilityWhere(actor) }] }),
      materialId: filter?.materialId || undefined,
      productId: filter?.productId || undefined,
      type: filter?.type || undefined,
    },
    orderBy: [{ createdAt: "desc" },{id:"desc"}],
    take: 500,
    include: {
      material: { select: { name: true, measurementUnit: { select: { name: true } } } },
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
    materialUnit: movement.material.measurementUnit.name,
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

export async function frozenGetProjectMaterials(
  productId: string,
  actor: VisibilityActor,
  database: Prisma.TransactionClient,
): Promise<ProjectMaterialsData> {
  if(!hasAnyRole(actor.roles,OFFICE_ROLES))throw new Error("Недостаточно прав");
  actor = await resolveVisibilityActor(database, actor);
  const [rows, movements] = await Promise.all([
    database.projectMaterial.findMany({
      where: { productId, product: productVisibilityWhere(actor) },
      orderBy: { createdAt: "asc" },
      include: {
        material: {
          select: { id: true, name: true, sku: true, measurementUnit: { select: { name: true } }, purchasePrice: true },
        },
      },
    }),
    frozenLoadMovements(actor, { productId }, database),
  ]);
  const stock = await warehouseReadPositions(database,rows.map((row) => row.materialId));
  const showMoney=hasAnyRole(actor.roles,WAREHOUSE_MONEY_ROLES);
  const [issued,allCosts]=await Promise.all([
    stock.current&&stock.runId ? database.warehouseMovementValuation.findMany({
      where:{runId:stock.runId,movement:{...activeStockMovementWhere,productId,product:productVisibilityWhere(actor),type:"EXPENSE"}},
      include:{movement:{select:{materialId:true,createdAt:true,material:{select:{name:true,measurementUnit:{select:{name:true}}}}}}}
    }) : Promise.resolve([]),
    showMoney ? database.stockMovement.findMany({where:{...activeStockMovementWhere,productId,product:productVisibilityWhere(actor),type:{in:["EXPENSE","RETURN"]}},select:{type:true,totalByn:true}}) : Promise.resolve([]),
  ]);
  const returnSources:WarehouseReturnSource[]=issued.map(item=>({id:item.movementId,materialId:item.movement.materialId,
    materialName:item.movement.material.name,unit:item.movement.material.measurementUnit.name,createdAt:item.movement.createdAt.toISOString(),
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
      unit: row.material.measurementUnit.name,
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


