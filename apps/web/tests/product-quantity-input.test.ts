import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acceptsQuantityDraft,stepQuantityDraft,productDraftTotal} from '../src/lib/product-quantity-input';
import {createInlineSaveController} from '../src/lib/inline-save-controller';

test('integer spinner rejects exponent/fraction/sign, defaults empty to1 and clamps without fractional drift',()=>{
 for(const bad of ['1e2','1.5','+1','-1','1,5',' 1','１２','12345678901'])assert.equal(acceptsQuantityDraft(bad),false);
 assert.equal(stepQuantityDraft('',1),'1');assert.equal(stepQuantityDraft('',-1),'1');assert.equal(stepQuantityDraft('1',-1),'1');assert.equal(stepQuantityDraft('3',1),'4');assert.equal(stepQuantityDraft('2147483647',1),'2147483647');assert.equal(stepQuantityDraft('1.5',1),null);
});
test('draft sum is exact unit price×integer count, NULL neverzero and invalid drafts stay unknown',()=>{
 assert.equal(productDraftTotal('12.34','4'),'49.36');assert.equal(productDraftTotal('12,34','3'),'37.02');assert.equal(productDraftTotal('0','3'),'0.00');assert.equal(productDraftTotal('','3'),null);assert.equal(productDraftTotal('12.34',''),null);assert.equal(productDraftTotal('12.34','0'),null);assert.equal(productDraftTotal('12.34','1e2'),null);assert.equal(productDraftTotal('12.345','3'),null);assert.equal(productDraftTotal('9999999999.99','2'),null);
});
test('stepped quantity commit preserves actual controller baseline/UUID after lost ACK',async()=>{
 const calls:{value:number;expectedValue:number;clientMutationId:string}[]=[];let fail=true;
 const control=createInlineSaveController<number>({initialValue:1,format:String,parse:value=>{const n=Number(value);if(!acceptsQuantityDraft(value)||!value||n<1||n>2147483647)throw Error('quantity');return n;},save:async input=>{calls.push(input);if(fail)throw Error('lost ACK');return{kind:'saved',value:input.value,clientMutationId:input.clientMutationId};}});
 control.setDraft(stepQuantityDraft(control.getSnapshot().draft,1)!);assert.equal(await control.commit(),false);assert.equal(calls[0].value,2);assert.equal(calls[0].expectedValue,1);fail=false;assert.equal(await control.retry(),true);assert.deepEqual(calls[0],calls[1]);assert.equal(control.getSnapshot().baseline,2);
 control.setDraft('');assert.equal(await control.commit(),false);assert.equal(calls.length,2);
});
test('older step ACK does not erase newer quantity draft or readonly draft sum',async()=>{
 let release!:(result:{kind:'saved';value:number;clientMutationId:string})=>void;let request!:{value:number;expectedValue:number;clientMutationId:string};
 const control=createInlineSaveController<number>({initialValue:1,format:String,parse:Number,save:input=>{request=input;return new Promise(done=>{release=done;});}});
 control.setDraft('2');const saving=control.commit();await new Promise(done=>setTimeout(done,0));control.setDraft(stepQuantityDraft(control.getSnapshot().draft,1)!);release({kind:'saved',value:request.value,clientMutationId:request.clientMutationId});await saving;assert.equal(control.getSnapshot().draft,'3');assert.equal(control.getSnapshot().baseline,2);assert.equal(control.getSnapshot().status,'dirty');assert.equal(productDraftTotal('12.34',control.getSnapshot().draft),'37.02');
});
