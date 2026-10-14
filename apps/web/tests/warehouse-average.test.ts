import assert from "node:assert/strict";
import { test } from "node:test";
import { addPosition, issuePosition, averagePrice, returnShare, quantityInput, priceInput, addValue, type WarehousePosition } from "../src/lib/warehouse-cost";
import { decimalAtoms, decimalText, materialPlanFloor, planQuantityChange } from "../src/lib/product-quantity";
import { planWarehouseDeletion, type DeletionFact } from "../src/server/warehouse/deletion-plan";
import { stockInventoryReceiptSchema, stockIssueSchema, stockReturnSchema } from "../src/server/warehouse/contracts";
import { warehouseMovementLabel, matchesWarehouseMovementKind } from "../src/lib/warehouse-movement-labels";

// Источник: warehouse-average.test.ts
test('220 BYN for 30 square metres retains weighted average after issue',()=>{
 let state={quantity:'0.000',value:'0.000000000'};
 for(const price of ['5','7','10'])state=addPosition(state,'10',price).position;
 assert.equal(averagePrice(state),'7.33');
 const issued=issuePosition(state,'10');
 assert.equal(issued.money,'73.33');assert.equal(issued.position.quantity,'20.000');
 assert.equal(averagePrice(issued.position),'7.33');
 assert.equal(averagePrice(addPosition(issued.position,'10','10').position),'8.22');
});
test('full issue consumes residual value and clears average',()=>{
 const state=addPosition({quantity:'0',value:'0'},'3','0.01').position;
 const next=issuePosition(state,'3');assert.equal(next.position.quantity,'0.000');
 assert.equal(next.position.value,'0.000000000');assert.equal(averagePrice(next.position),'0.00');
 assert.throws(()=>issuePosition(state,'3.001'));
});
test('last partial return restores exact and rounded source amounts',()=>{
 const source={quantity:'3.000',value:'22.000000000',money:'22.00',returnedQuantity:'0',returnedValue:'0',returnedMoney:'0'};
 const first=returnShare(source,'1');assert.equal(first.money,'7.33');
 const second=returnShare({...source,returnedQuantity:'1',returnedValue:first.value,returnedMoney:first.money},'1');
 const last=returnShare({...source,returnedQuantity:'2',returnedValue:'14.666666666',returnedMoney:'14.66'},'1');
 assert.equal(second.money,'7.33');assert.equal(last.money,'7.34');assert.equal(last.value,'7.333333334');
 assert.throws(()=>returnShare(source,'3.001'));
});
test('positive invoice price and quantity reject empty, zero and lossy numbers',()=>{
 for(const value of ['',0,-1,NaN,Infinity,'0.001','1e3'])assert.throws(()=>priceInput(value));
 for(const value of ['',0,-1,NaN,Infinity,'0.0001'])assert.throws(()=>quantityInput(value));
 assert.equal(priceInput('7,50'),'7.50');assert.equal(quantityInput('0,125'),'0.125');
});

test('many small returns never refund more cents than their source issue',()=>{
 const source={quantity:'1.000',value:'0.020000000',money:'0.02',returnedQuantity:'0',returnedValue:'0',returnedMoney:'0'};
 for(let i=0;i<4;i++){
  const part=returnShare(source,'0.25');
  assert.ok(decimalAtoms(part.money,2,12)>=BigInt(0));
  source.returnedQuantity=decimalText(decimalAtoms(source.returnedQuantity,3,12)+BigInt(250),3);
  source.returnedValue=decimalText(decimalAtoms(source.returnedValue,9,30)+decimalAtoms(part.value,9,30),9);
  source.returnedMoney=decimalText(decimalAtoms(source.returnedMoney,2,12)+decimalAtoms(part.money,2,12),2);
  assert.ok(decimalAtoms(source.returnedMoney,2,12)<=BigInt(2));
 }
 assert.equal(source.returnedValue,'0.020000000');assert.equal(source.returnedMoney,'0.02');
});

// Источник: warehouse-deletion-plan.test.ts
function fixture(){
 const rows:DeletionFact[]=[];let position:WarehousePosition={quantity:'0',value:'0'};
 const counters=new Map<string,{quantity:string;value:string;money:string;returnedQuantity:string;returnedValue:string;returnedMoney:string}>();
 function add(id:string,type:DeletionFact['type'],quantity:string,priceOrSource:string){
  let result,sourceId:string|null=null;
  if(type==='INCOME')result=addPosition(position,quantity,priceOrSource);
  else if(type==='EXPENSE')result=issuePosition(position,quantity);
  else{sourceId=priceOrSource;const source=counters.get(sourceId)!;const share=returnShare(source,quantity);result={...share,position:addValue(position,quantity,share.value)};
   source.returnedQuantity=String(Number(source.returnedQuantity)+Number(quantity));source.returnedValue=String(Number(source.returnedValue)+Number(share.value));source.returnedMoney=String(Number(source.returnedMoney)+Number(share.money));}
  position=result.position;
  rows.push({id,type,quantity,unitCost:result.cost,value:result.value,money:result.money,sourceId,revision:rows.length+1,createdAt:new Date('2026-10-08').toISOString()});
  if(type==='EXPENSE')counters.set(id,{quantity,value:result.value,money:result.money,returnedQuantity:'0',returnedValue:'0',returnedMoney:'0'});
 }
 return {rows,add,get position(){return position}};
}
test('37kg/3700 receipt cancellation zeroes position',()=>{
 const f=fixture();f.add('receipt','INCOME','37','100');const p=planWarehouseDeletion(f.rows,f.position,'receipt');
 assert.deepEqual(p.deleted.map(x=>x.id),['receipt']);assert.equal(Number(p.position.quantity),0);assert.equal(Number(p.position.value),0);
});
test('receipt cascades through valuation dependency and linked return, preserving independent income',()=>{
 const f=fixture();f.add('bad','INCOME','10','100');f.add('good','INCOME','10','200');f.add('issue','EXPENSE','20','');f.add('return','RETURN','5','issue');
 const p=planWarehouseDeletion(f.rows,f.position,'bad');assert.deepEqual(p.deleted.map(x=>x.id),['bad','issue','return']);
 assert.equal(Number(p.position.quantity),10);assert.equal(Number(p.position.value),2000);
});
test('cascade propagates to later issue prices without repricing or deleting independent receipts',()=>{
 const f=fixture();f.add('bad','INCOME','10','100');f.add('good','INCOME','10','200');f.add('issue','EXPENSE','20','');f.add('later','INCOME','10','300');f.add('later-issue','EXPENSE','10','');
 const p=planWarehouseDeletion(f.rows,f.position,'bad');assert.deepEqual(p.deleted.map(x=>x.id),['bad','issue','later-issue']);
 assert.equal(Number(p.position.quantity),20);assert.equal(Number(p.position.value),5000);
});
test('same-cost independent stock can preserve an issue and a deleted return resets source counters',()=>{
 const f=fixture();f.add('bad','INCOME','10','20');f.add('good','INCOME','10','20');f.add('issue','EXPENSE','3','');f.add('return','RETURN','1','issue');
 assert.deepEqual(planWarehouseDeletion(f.rows,f.position,'bad').deleted.map(x=>x.id),['bad']);
 const p=planWarehouseDeletion(f.rows,f.position,'return');assert.deepEqual(p.deleted.map(x=>x.id),['return']);assert.equal(p.returns.get('issue')?.quantity,'0.000');
});
test('legacy ordering must be unambiguous and every baseline snapshot/balance must reconcile',()=>{
 const f=fixture();f.add('r','INCOME','10','20');f.add('e','EXPENSE','3','');
 assert.throws(()=>planWarehouseDeletion(f.rows,{quantity:'8',value:'160'},'r'),/сверк|остат/i);
 assert.throws(()=>planWarehouseDeletion(f.rows.map(x=>({...x,revision:null})),f.position,'r'),/поряд|истори/i);
 assert.throws(()=>planWarehouseDeletion(f.rows.map(x=>x.id==='e'?{...x,value:'61'}:x),f.position,'r'),/сним|учёт/i);
 assert.throws(()=>planWarehouseDeletion(f.rows,f.position,'missing'),/найден/i);
});

// Источник: warehouse-receipt-kinds.test.ts
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

// Источник: direct-stock-contract.test.ts
const base={clientMutationId:"96cc1e10-6b50-48d6-8e06-9445b1d4c882",quantity:"3"};
test("one issue contract supports direct product/material and legacy need, never a client price",()=>{
 assert.equal(stockIssueSchema.safeParse({...base,productId:"p",materialId:"m"}).success,true);
 assert.equal(stockIssueSchema.safeParse({...base,projectMaterialId:"line"}).success,true);
 for(const extra of [{productId:"p"},{materialId:"m"},{productId:"p",materialId:"m",projectMaterialId:"line"},{productId:"p",materialId:"m",unitPrice:"20"}])
  assert.equal(stockIssueSchema.safeParse({...base,...extra}).success,false);
});
test("direct return requires source and product, legacy manual price remains confined to a need",()=>{
 assert.equal(stockReturnSchema.safeParse({...base,productId:"p",sourceMovementId:"source"}).success,true);
 assert.equal(stockReturnSchema.safeParse({...base,projectMaterialId:"line",sourceMovementId:"source"}).success,true);
 assert.equal(stockReturnSchema.safeParse({...base,projectMaterialId:"line",unitPrice:"20"}).success,true);
 assert.equal(stockReturnSchema.safeParse({...base,productId:"p",unitPrice:"20"}).success,false);
 assert.equal(stockReturnSchema.safeParse({...base,productId:"p",sourceMovementId:"source",unitPrice:"20"}).success,false);
});
test("over-issue cannot force artificial plan growth while previous ordinary decrease guards remain",()=>{
 assert.equal(materialPlanFloor("2","3"),"2.000");assert.equal(materialPlanFloor("10","3"),"3.000");
 const line={id:"n",quantity:"2",quantityPerUnit:"2",issuedQty:"3",material:{name:"Петля"}};
 assert.equal(planQuantityChange(1,1,[],[line]).materials[0].quantity,"2.000");
 assert.equal(planQuantityChange(1,2,[],[line]).materials[0].quantity,"4.000");
 assert.throws(()=>planQuantityChange(2,1,[],[{...line,quantity:"4",issuedQty:"3"}]),/верните/);
 assert.throws(()=>planQuantityChange(2,1,[],[{...line,quantity:"4",issuedQty:"6"}]),/верните/);
});
