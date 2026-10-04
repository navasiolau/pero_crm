import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acceptsPercentageDraft,parsePercentageInput,stepPercentageDraft} from '../src/lib/percentage-rate-input';
import {createSinglePercentageControllers} from '../src/lib/single-percentage-controller';
import type {ProductPercentagePatch,ProductPercentagePatchResult} from '../src/server/product-percentage-pay/contracts';

test('ASCII input rejects exponent/sign/comma/whitespace/third decimal and preserves NULL/zero',()=>{
 for(const bad of ['1e2','1E2','+1','-1','5,1',' 5','5 ','1.123','１２','1..2']){assert.equal(acceptsPercentageDraft(bad),false);assert.throws(()=>parsePercentageInput(bad));}
 assert.equal(parsePercentageInput(''),null);assert.equal(parsePercentageInput('0'),'0.00');assert.equal(parsePercentageInput('5.05'),'5.05');assert.throws(()=>parsePercentageInput('100.01'));
});
test('integer hundredths give exact 0.1 steps, retain hundredth precision and clamp endpoints',()=>{
 assert.equal(stepPercentageDraft('5.05',1),'5.15');assert.equal(stepPercentageDraft('5.05',-1),'4.95');assert.equal(stepPercentageDraft('99.95',1),'100');assert.equal(stepPercentageDraft('0.05',-1),'0');assert.equal(stepPercentageDraft('',1),'0.1');assert.equal(stepPercentageDraft('',-1),'0');assert.equal(stepPercentageDraft('5.',1),'5.1');assert.equal(stepPercentageDraft('.',1),null);
 let value='0';for(let i=0;i<1000;i++)value=stepPercentageDraft(value,1)!;assert.equal(value,'100');for(let i=0;i<1000;i++)value=stepPercentageDraft(value,-1)!;assert.equal(value,'0');
});
const saved=(input:ProductPercentagePatch):ProductPercentagePatchResult=>({ok:true,kind:'saved',field:input.field,value:input.value,revision:input.expectedRevision+1,clientMutationId:input.clientMutationId,noOp:false,repeated:false});
test('stepped dirty draft retains CAS/UUID after lost ACK and does not save invalid comma',async()=>{
 const calls:ProductPercentagePatch[]=[];let lost=true;
 const group=createSinglePercentageControllers({productId:'p',kind:'ENGINEERING',initial:{ratePercent:'5',assigneeId:'e'},revision:4,save:async input=>{calls.push(input);if(lost)throw Error('lost ACK');return saved(input);}});
 const rate=group.controllers.ratePercent;rate.setDraft('5.05');rate.setDraft(stepPercentageDraft(rate.getSnapshot().draft,1)!);assert.equal(await rate.commit(),false);assert.equal(calls[0].expectedValue,'5');assert.equal(calls[0].value,'5.15');assert.equal(calls[0].expectedRevision,4);lost=false;assert.equal(await rate.retry(),true);assert.deepEqual(calls[0],calls[1]);
 rate.setDraft('5,25');assert.equal(await rate.commit(),false);assert.equal(calls.length,2);rate.setDraft('');assert.equal(await rate.commit(),true);assert.equal(calls[2].value,null);rate.setDraft('0');assert.equal(await rate.commit(),true);assert.equal(calls[3].value,'0');
});
test('an older ACK cannot overwrite a newer stepped draft',async()=>{
 let resolve!:(result:ProductPercentagePatchResult)=>void;let input!:ProductPercentagePatch;
 const group=createSinglePercentageControllers({productId:'p',kind:'ENGINEERING',initial:{ratePercent:'5',assigneeId:'e'},revision:0,save:request=>{input=request;return new Promise(done=>{resolve=done;});}});
 const rate=group.controllers.ratePercent;rate.setDraft('5.1');const pending=rate.commit();await new Promise(done=>setTimeout(done,0));rate.setDraft(stepPercentageDraft(rate.getSnapshot().draft,1)!);resolve(saved(input));await pending;assert.equal(rate.getSnapshot().draft,'5.2');assert.equal(rate.getSnapshot().baseline,'5.1');assert.equal(rate.getSnapshot().status,'dirty');
});
