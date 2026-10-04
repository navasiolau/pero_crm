import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { changeTaskStatusCore } from '../src/server/tasks/completion-core';
import { taskShareFixture } from './helpers/task-share-fixture';
const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function coveredFixture(state:string|null,rate='5',kind:'ASSEMBLY'|'INSTALLATION'='INSTALLATION'){
 const f=taskShareFixture();
 f.database.productPercentageConfig.findMany=(async()=>[{kind,ratePercent:new Prisma.Decimal(rate),workReview:[{workId:'work',classification:'COVERED'}],product:{projectId:'project',quantity:1,expectedPrice:new Prisma.Decimal('1000'),project:{currency:'BYN'},mounter:{active:true,roles:['MOUNTER']},assembler:{active:true,roles:['WORKER']},percentageCompletions:state?[{kind,state,calculationVersion:2,ratePercentSnapshot:new Prisma.Decimal(rate)}]:[]}}]) as never;
 Object.assign(f.database.work,{findMany:async()=>f.state().works.map(work=>({...work,tasks:f.state().tasks.filter(task=>task.workId===work.id)}))});
 Object.assign(f.database.payrollEntry,{findMany:async()=>f.state().entries});
 return f;
}
test('retired direct coverage leaves ordinary PIECE accrual independent',async()=>{
 for(const kind of ['ASSEMBLY','INSTALLATION'] as const)for(const state of [null,'SETTLED']){const f=coveredFixture(state,'5',kind);assert.equal((await changeTaskStatusCore(actor,'source','DONE',20,f.transaction)).ok,true);assert.equal(f.state().entries.length,1);assert.equal(f.state().tasks[0].status,'DONE');}
});
test('SKIPPED/protected/zero configurations preserve legacyPIECE, including historicalgroups',async()=>{
 for(const [state,rate] of [['SKIPPED_ONCE','5'],['LEGACY_PROTECTED','5'],[null,'0']] as const){const f=coveredFixture(state,rate);assert.equal((await changeTaskStatusCore(actor,'source','DONE',20,f.transaction)).ok,true);assert.equal(Number(f.state().entries[0].amount),1000);}
 const f=coveredFixture('SETTLED');Object.assign(f.state().tasks[0],{allocationGroupId:'historic',shareUnits:700000,shareAmount:'700.00'});f.state().groups.push({id:'historic',workId:'work',quantity:'10',budget:'1000.00',currency:'BYN',budgetSource:'TASK_FIXED'});assert.equal((await changeTaskStatusCore(actor,'source','DONE',20,f.transaction)).ok,true);assert.equal(Number(f.state().entries[0].amount),700);
});
