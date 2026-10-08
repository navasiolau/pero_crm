import assert from 'node:assert/strict';
import test from 'node:test';
import {planWarehouseDeletion,type DeletionFact} from '../src/server/warehouse/deletion-plan';
import {addPosition,issuePosition,returnShare,addValue,type WarehousePosition} from '../src/lib/warehouse-cost';
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
