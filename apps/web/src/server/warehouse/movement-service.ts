import { prisma } from "@/lib/prisma";
import { formatQty } from "@/lib/format";
import { WAREHOUSE_MANAGE_ROLES } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { warehouseMove } from "./accounting";
import { stockInventoryReceiptSchema, stockIssueSchema, stockReturnSchema } from "./contracts";
import { revalidateWarehouse } from "./revalidate";

export async function createStockMovementCore(actor: DomainActor, kind: "INCOME" | "EXPENSE" | "RETURN", input: unknown) {
  requireActorRoles(actor,WAREHOUSE_MANAGE_ROLES);
  const schema=kind==="INCOME"?stockInventoryReceiptSchema:kind==="EXPENSE"?stockIssueSchema:stockReturnSchema;
  const parsed=schema.safeParse(input);
  if(!parsed.success)return {ok:false,error:parsed.error.issues[0]?.message??"Ошибка данных"};
  let result;
  try { result=await prisma.$transaction(tx=>warehouseMove(tx,actor,{...parsed.data,kind}),{maxWait:10000,timeout:15000}); }
  catch(error){return {ok:false,error:error instanceof Error?error.message:"Не удалось сохранить складское движение"};}
  if(!result.repeated){
    if(result.eventId)await dispatchEvent(result.eventId).catch(()=>console.error("[warehouse] Событие осталось в очереди"));
    if(kind==="EXPENSE"&&result.product&&result.material)await notifyOrg({type:"stock.expense",
      title:`Списание: ${result.material.name} × ${formatQty(parsed.data.quantity)} · ${result.product.number}`,
      link:`/products/${result.product.id}`,exceptUserId:actor.id}).catch(()=>console.error("[warehouse] Уведомление не отправлено"));
  }
  await revalidateWarehouse(result.movement.productId,result.product?.projectId);
  return {ok:true,movementId:result.movement.id,repeated:result.repeated};
}
