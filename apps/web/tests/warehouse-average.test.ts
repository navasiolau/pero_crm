import assert from 'node:assert/strict';
import test from 'node:test';
import { addPosition, issuePosition, averagePrice, returnShare, quantityInput, priceInput } from '../src/lib/warehouse-cost';
import {decimalAtoms,decimalText} from '../src/lib/product-quantity';

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
