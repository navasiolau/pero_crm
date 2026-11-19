import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { journalProductContext } from "@/server/finance/journal";
import { deleteMovementInTransaction, previewWarehouseJournalHide } from "./deletion-core";
import { prepareWarehouseRestoration, restoreWarehouseDeletionInTransaction } from "./movement-restoration";
import { warehouseMovementReversalKind, warehouseMovementReversalSchema } from "./movement-reversal-contract";

function paths(products:{id:string;projectId:string;number?:string}[]){
  return ["/warehouse","/warehouse/stock","/warehouse/movements","/warehouse/items","/finance","/finance/expenses",
    "/finance/accounts","/finance/accounts/report","/projects","/products",
    ...products.flatMap(row=>[`/products/${row.id}`,...(row.number?[`/products/${row.number}`]:[]),
      `/projects/${row.projectId}`,`/finance/projects/${row.projectId}`])];
}
const message=(error:unknown)=>error instanceof Error?error.message:"Складская операция изменилась";
export const warehouseMovementReversal=defineJournalReversal({
  kind:warehouseMovementReversalKind,
  version:1,
  schema:warehouseMovementReversalSchema,
  async preview(ctx,data){
    try{
      if(data.mode==="hide")await previewWarehouseJournalHide(ctx.tx,ctx.actor,data);
      else await prepareWarehouseRestoration(ctx.tx,ctx.actor,data.deletionId);
      return null;
    }catch(error){return message(error);}
  },
  async apply(ctx,data){
    try{
      if(data.mode==="hide"){
        const result=await deleteMovementInTransaction(ctx.tx,ctx.actor,{movementId:data.movementId,
          clientMutationId:ctx.reversalId!.slice("journal-reversal:".length)},
          {expected:data,rootId:ctx.reversalId!});
        const preview=result.preview;
        if(!preview)throw new JournalReversalRefusal("Удаление уже было подтверждено");
        return {inverse:{mode:"restore" as const,deletionId:result.id},eventIds:result.eventId?[result.eventId]:[],
          oldValue:{warehouseBalance:preview.before},newValue:{warehouseBalance:preview.after,refunds:preview.refunds},
          cachePaths:paths(result.productRefs)};
      }
      const result=await restoreWarehouseDeletionInTransaction(ctx.tx,ctx.actor,data.deletionId);
      const root=result.movements.find(row=>row.id===result.deletion.rootMovementId)!;
      const products=[...new Map(result.movements.flatMap(row=>row.product?[[row.product.id,row.product] as const]:[])).values()];
      return {inverse:{mode:"hide" as const,movementId:root.id,revision:root.warehouseLifecycleRevision+1,movementIds:result.snapshot.movementIds},
        oldValue:{warehouseBalance:result.snapshot.after},newValue:{warehouseBalance:result.snapshot.before,
          movementIds:result.snapshot.movementIds,paymentIds:result.snapshot.paymentIds},
        hints:{contexts:products.map(journalProductContext)},eventIds:[result.eventId],cachePaths:paths(products)};
    }catch(error){throw new JournalReversalRefusal(message(error));}
  },
});
