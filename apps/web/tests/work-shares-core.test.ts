import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DomainActor } from '../src/server/projects/core';
import { splitTaskCore, type SplitTaskInput } from '../src/server/tasks/share-core';
import { taskShareFixture, historicalTaskAllocation } from './helpers/task-share-fixture';
const actor:DomainActor={id:'worker',name:'Worker',roles:['WORKER'],source:'web'};
const input=(changes:Partial<SplitTaskInput>={}):SplitTaskInput=>({taskId:'source',recipientId:'recipient',percent:'30',expectedRevision:0,requestId:randomUUID(),...changes});
test('retirement rejects inactive recipients, stale revision, completed/paid and standalone tasks without modifying state',async()=>{
 for(const variation of ['inactive','stale','done','paid','standalone','oldgroup']) {
 const f=taskShareFixture(); const request=input();
 if(variation==='inactive')f.state().users.find(user=>user.id==='recipient')!.active=false;
 if(variation==='stale')request.expectedRevision=5;
 if(variation==='done')f.state().tasks[0].status='DONE';
 if(variation==='paid')f.state().entries.push({id:'paid',taskId:'source',amount:'1000.00'});
 if(variation==='standalone')f.state().tasks[0].workId=null;
 if(variation==='oldgroup')historicalTaskAllocation(f);
 const before=structuredClone(f.state());
 assert.equal((await splitTaskCore(actor,request,f.transaction)).ok,false,variation);
 assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
 }
});
test('prior committed receipt replays only the same actor and exact payload without writes',async()=>{
 const f=taskShareFixture();historicalTaskAllocation(f);const request=input();
 f.state().logs.push({id:`task-split:${request.requestId}`,actorId:'worker',entityId:'source',action:'split',newValue:{recipientId:'recipient',percent:'30.00',expectedRevision:0,childTaskId:'historic-child',groupId:'historic-group'}});
 const before=structuredClone(f.state());
 const replay=await splitTaskCore(actor,request,f.transaction);assert.ok(replay.ok);assert.equal(replay.repeated,true);
 for(const change of [{percent:'50'},{recipientId:'accountant'},{expectedRevision:1}])assert.equal((await splitTaskCore(actor,{...request,...change},f.transaction)).ok,false);
 assert.equal((await splitTaskCore({...actor,id:'manager',roles:['MANAGER']},request,f.transaction)).ok,false);
 assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
});
test('concurrent new requests create no allocation, children, dependencies, audit or outbox',async()=>{
 const f=taskShareFixture();const before=structuredClone(f.state());
 const results=await Promise.all([splitTaskCore(actor,input(),f.transaction),splitTaskCore(actor,input(),f.transaction)]);
 assert.ok(results.every(result=>!result.ok));assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
});
