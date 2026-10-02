import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {instrumentDescriptionHydrationAsset} from './product-description-hydration-diagnostic.mjs';
const source='var rN={nodeType:1,nodeName:"SPAN",id:"product-inline-description-state"};function rD(e){var n=Error(i(418,1<arguments.length&&void 0!==arguments[1]&&arguments[1]?"text":"HTML",""));throw rU(rd(n,e)),rF}';
const sha=text=>createHash('sha256').update(text).digest('hex');
const args={source,expectedSha256:sha(source),nextVersion:'15.5.20',enabled:true};
test('diagnostic refuses default mode, unreviewed hash/version/seam and cursor',()=>{
 for(const change of [{enabled:false},{expectedSha256:'0'.repeat(64)},{nextVersion:'15.5.21'},{source:source+source,expectedSha256:sha(source+source)},{source:source.replace('rD','other'),expectedSha256:sha(source.replace('rD','other'))}])assert.throws(()=>instrumentDescriptionHydrationAsset({...args,...change}));
});
test('annotation records host/path without text or arbitrary props and still queues original418 then throws same sentinel',()=>{
 const result=instrumentDescriptionHydrationAsset(args),sentinel={original:'HydrationMismatchException'},queued=[];
 const fiber={tag:5,type:'div',pendingProps:{id:'product-inline-description-state',className:'flex min-w-0',role:'group','data-slot':'avatar',description:'private-text',cookie:'secret'},return:{tag:5,type:'section',pendingProps:{id:'arbitrary-user-id'}}};
 const context={i:code=>`React error ${code}`,rd:(error,fiber)=>({error,fiber}),rU:value=>queued.push(value),rF:sentinel};
 runInNewContext(result.source,context);
 assert.throws(()=>context.rD(fiber),error=>error===sentinel);
 assert.equal(queued.length,1);assert.equal(queued[0].fiber,fiber);assert.match(queued[0].error.message,/React error 418/);
 const diagnostic=JSON.parse(JSON.stringify(context.__qa19HydrationMismatches));
 assert.equal(diagnostic[0].host.type,'div');assert.equal(diagnostic[0].host.className,'flex min-w-0');assert.equal(diagnostic[0].host.slot,'avatar');assert.equal(diagnostic[0].host.role,'group');assert.equal(diagnostic[0].nextHydratable.nodeName,'SPAN');
 assert.doesNotMatch(JSON.stringify(diagnostic),/private-text|secret|arbitrary-user-id/);
 assert.equal(result.metadata.normalAcceptance,false);
});
