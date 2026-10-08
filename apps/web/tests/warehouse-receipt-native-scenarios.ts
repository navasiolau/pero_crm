import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { warehouseMove } from "../src/server/warehouse/accounting";
import { warehouseMovementLabel } from "../src/lib/warehouse-movement-labels";

export async function receiptKindBaseline(db: PrismaClient) {
  const result:Record<string,unknown>={};
  for(const table of ["WarehouseAccountingState","WarehouseBalance","WarehouseMovementValuation","Material","StockMovement","User","Payment","Payout","ChangeLog","DomainEvent"])
    result[table]=await db.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) x`);
  return result;
}
export async function runWarehouseReceiptNative(db: PrismaClient) {
  const before=await receiptKindBaseline(db), abort=Error("QA102_ROLLBACK"), marker=`qa102-${randomUUID()}`;
  let verified=false;
  try{
    await db.$transaction(async tx=>{
      const state=await tx.warehouseAccountingState.findUnique({where:{id:"main"}});
      if(state)assert.equal(state.phase,"ACTIVE","EXISTING_WAREHOUSE_MUST_BE_ACTIVE");
      else await tx.warehouseAccountingState.create({data:{id:"main",phase:"ACTIVE",runId:marker,beforePrices:{},beforeBalances:{}}});
      const user=await tx.user.create({data:{id:marker,name:marker,email:`${marker}@invalid.local`,passwordHash:"qa-login-disabled",roles:["PROCUREMENT"]}});
      const material=await tx.material.create({data:{id:marker,name:marker,purchasePrice:0}});
      const actor={id:user.id,roles:user.roles},input={kind:"INCOME" as const,clientMutationId:randomUUID(),materialId:material.id,quantity:"3",unitPrice:"20"};
      const payments=await tx.payment.count(),payouts=await tx.payout.count();
      const first=await warehouseMove(tx,actor,input),repeat=await warehouseMove(tx,actor,input);
      assert.equal(first.movement.receiptKind,"INVENTORY");
      assert.equal(warehouseMovementLabel(first.movement),"Инвентарный приход");
      assert.equal(repeat.movement.id,first.movement.id);assert.equal(repeat.repeated,true);
      const balance=await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}});
      assert.equal(balance.quantity.toString(),"3");assert.equal(balance.valueByn.toFixed(2),"60.00");
      assert.equal(await tx.stockMovement.count({where:{materialId:material.id}}),1);
      assert.equal(await tx.payment.count(),payments);assert.equal(await tx.payout.count(),payouts);
      await assert.rejects(warehouseMove(tx,{...actor,roles:["WORKER"]},input),/прав/);
      await tx.$executeRawUnsafe("SAVEPOINT receipt_kind_guard");
      await assert.rejects(tx.stockMovement.update({where:{id:first.movement.id},data:{type:"EXPENSE"}}),/StockMovement_receipt_kind_check/);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT receipt_kind_guard");
      assert.equal(await tx.domainEvent.count({where:{actor:user.id}}),1);
      assert.equal(await tx.changeLog.count({where:{actorId:user.id,entity:"stockMovement"}}),1);
      verified=true;throw abort;
    },{maxWait:10000,timeout:15000});
  }catch(error){if(error!==abort)throw error;}
  assert.ok(verified);assert.deepEqual(await receiptKindBaseline(db),before,"ORIGINAL_DATA_CHANGED");
  return {status:"PASS",stockQuantity:3,stockValueByn:60,receiptKind:"INVENTORY",movementCount:1,cash:"UNCHANGED",originalData:"MATCH",qaRows:"ROLLED_BACK",providerMessages:0};
}
