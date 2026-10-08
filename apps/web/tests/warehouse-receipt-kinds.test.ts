import assert from "node:assert/strict";
import test from "node:test";
import { stockInventoryReceiptSchema } from "../src/server/warehouse/contracts";
import { warehouseMovementLabel, matchesWarehouseMovementKind } from "../src/lib/warehouse-movement-labels";
const input={materialId:"material",quantity:"3",unitPrice:"20",clientMutationId:"dbd84881-fc3a-4c81-94d1-31f9f15f9657"};
test("inventory contract rejects a paid flag or cash data and preserves legacy input compatibility",()=>{
 assert.equal(stockInventoryReceiptSchema.parse(input).receiptKind,"INVENTORY");
 assert.equal(stockInventoryReceiptSchema.safeParse({...input,receiptKind:"PAID"}).success,false);
 assert.equal(stockInventoryReceiptSchema.safeParse({...input,cashAccountId:"cash"}).success,false);
});
test("labels and filters keep paid, inventory and unknown history distinct",()=>{
 const inventory={type:"INCOME",receiptKind:"INVENTORY"} as const,paid={type:"INCOME",receiptKind:"PAID"} as const,legacy={type:"INCOME",receiptKind:null} as const;
 assert.equal(warehouseMovementLabel(inventory),"Инвентарный приход");
 assert.equal(warehouseMovementLabel(paid),"Приход с оплатой");
 assert.equal(warehouseMovementLabel(legacy),"Приход (вид не указан)");
 for(const row of [inventory,paid,legacy])assert.equal(matchesWarehouseMovementKind(row,"INCOME"),true);
 assert.equal(matchesWarehouseMovementKind(inventory,"INVENTORY"),true);
 assert.equal(matchesWarehouseMovementKind(legacy,"INVENTORY"),false);
 assert.equal(matchesWarehouseMovementKind(paid,"PAID"),true);
 assert.equal(matchesWarehouseMovementKind(legacy,"UNCLASSIFIED"),true);
 assert.equal(warehouseMovementLabel({type:"RETURN",receiptKind:null}),"Возврат");
});
