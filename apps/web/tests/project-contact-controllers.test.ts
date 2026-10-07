import assert from 'node:assert/strict';
import test from 'node:test';
import {createProjectContactControllers} from '../src/lib/project-contact-controllers';
import type {ProjectPatch,ProjectPatchResult} from '../src/server/projects/patch-contract';
const initial={clientId:'a','client.phone':'100','client.address':'Client A'};
function saved(input:ProjectPatch):ProjectPatchResult{return{kind:'saved',field:input.field,value:input.value,clientMutationId:input.clientMutationId,...(input.field==='clientId'?{derived:{clientId:String(input.value),phone:'200',clientAddress:'Client B'}}:{})};}
test('client switch waits for delayed contact ACK and binds only canonical new contacts',async()=>{
 const calls:ProjectPatch[]=[];let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 const group=createProjectContactControllers('project',initial,async input=>{calls.push(input);if(input.field==='client.phone')await wait;return saved(input);});
 const phone=group.controller('client.phone');phone.setDraft('300');const saving=phone.commit();
 const client=group.controller('clientId');client.setDraft('b');const switching=client.commit();
 assert.equal(group.getSnapshot().switching,true);assert.deepEqual(calls.map(row=>row.field),['client.phone']);assert.equal(group.getSnapshot().clientId,'a');
 release();assert.equal(await saving,true);assert.equal(await switching,true);
 assert.deepEqual(calls.map(row=>row.field),['client.phone','clientId']);assert.equal('expectedClientId' in calls[0]&&calls[0].expectedClientId,'a');
 assert.equal(group.getSnapshot().clientId,'b');assert.equal(group.controller('client.phone').getSnapshot().baseline,'200');assert.equal(group.controller('client.address').getSnapshot().baseline,'Client B');
});
test('failed contact flush preserves input and blocks selection request',async()=>{
 const calls:ProjectPatch[]=[];const group=createProjectContactControllers('project',initial,async input=>{calls.push(input);return{kind:'failure',field:input.field,clientMutationId:input.clientMutationId,error:'Rejected'};});
 group.controller('client.address').setDraft('My draft');group.controller('clientId').setDraft('b');assert.equal(await group.controller('clientId').commit(),false);
 assert.deepEqual(calls.map(row=>row.field),['client.address']);assert.equal(group.getSnapshot().clientId,'a');assert.equal(group.controller('client.address').getSnapshot().draft,'My draft');
});
test('server refresh cannot bind old drafts to another client or erase pending input',async()=>{
 const group=createProjectContactControllers('project',initial,async input=>saved(input));
 group.controller('client.phone').setDraft('My draft');assert.equal(group.receive({clientId:'b','client.phone':'200','client.address':'B'}),false);
 assert.equal(group.getSnapshot().clientId,'a');assert.equal(group.controller('clientId').getSnapshot().baseline,'a');assert.equal(group.controller('client.phone').getSnapshot().draft,'My draft');
});
test('binding conflict cannot rebase a contact onto a different client',async()=>{
 const group=createProjectContactControllers('project',initial,async input=>({kind:'conflict',field:input.field,clientMutationId:input.clientMutationId,error:'Changed',currentValue:'200',currentClientId:'b'}));
 const phone=group.controller('client.phone');phone.setDraft('My draft');assert.equal(await phone.commit(),false);assert.equal(phone.getSnapshot().currentValue,undefined);
 assert.equal(await phone.rebaseAndRetry(),false);assert.equal(phone.getSnapshot().draft,'My draft');assert.equal(group.getSnapshot().clientId,'a');
});
test('clean server renders replace canonical contacts and unchanged legacy empty phone permits selection',async()=>{
 const group=createProjectContactControllers('project',{...initial,'client.phone':''},async input=>saved(input));
 group.controller('clientId').setDraft('b');assert.equal(await group.controller('clientId').commit(),true);
 assert.equal(group.receive({clientId:'b','client.phone':'New phone','client.address':null}),true);
 assert.equal(group.controller('client.phone').getSnapshot().baseline,'New phone');assert.equal(group.controller('client.address').getSnapshot().baseline,null);
});
