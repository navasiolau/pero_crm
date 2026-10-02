import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { splitTaskCore } from '../src/server/tasks/share-core';
import { canSplitTask } from '../src/server/tasks/share-policy';
import { taskShareFixture } from './helpers/task-share-fixture';
import { allocatedWorkQuantity, taskPieceAmount } from '../src/lib/work-shares';
import type { DomainActor } from '../src/server/projects/core';
for (const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['WORKER'],['MOUNTER'],['ACCOUNTANT'],['ENGINEER'],['MANAGER','ENGINEER']] as DomainActor['roles'][]) {
 test(`new split denied without writes ${roles}`,async()=>{
 const f=taskShareFixture(); const actor:DomainActor={id:roles.includes('WORKER')?'worker':'manager',name:'actor',roles,source:'web'};
 const result=await splitTaskCore(actor,{taskId:'source',recipientId:'recipient',percent:'30',expectedRevision:0,requestId:randomUUID()},f.transaction);
 assert.equal(result.ok,false); assert.deepEqual(f.writes,[]);
 assert.equal(canSplitTask(actor,{assigneeId:actor.id,status:'NEW',product:null,paidCount:0}),false);
 });
}
test('historical grouped budget counts quantity once and preserves fixed40+60',()=>{
 const rows=[{quantity:'10',allocationGroupId:'old',shareAmount:'40',executorShare:'0.4'},{quantity:'10',allocationGroupId:'old',shareAmount:'60',executorShare:'0.6'}];
 assert.equal(allocatedWorkQuantity(rows),'10.00');
 assert.deepEqual(rows.map(row=>taskPieceAmount(row,'10')),['40.00','60.00']);
 assert.equal(taskPieceAmount({quantity:'4',executorShare:'0.5',shareAmount:null},'10'),'20.00');
});
