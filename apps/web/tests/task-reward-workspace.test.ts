import assert from 'node:assert/strict';import {test} from 'node:test';
import {taskReward,taskWorkspaceBindings,taskWorkspaceEligibility} from '../src/server/tasks/workspace-contract';
import {matches,queryRows,type FixtureRow} from './helpers/visibility-fixture';
import type {PrismaClient} from '@prisma/client';
test('zero and exact allocated Work amount remain known',()=>{
  assert.deepEqual(taskReward({quantity:'2',executorShare:'1'},'0','BYN'),{rewardAmount:'0.00',rewardCurrency:'BYN',rewardSource:'WORK_SNAPSHOT'});
  assert.equal(taskReward({quantity:'3.50',executorShare:'1'},'12.34','BYN').rewardAmount,'43.19');
});
test('historical fixed share is not repriced or multiplied again',()=>{
  const task={quantity:'100',executorShare:'0.5',allocationGroupId:'old',shareAmount:'17.89'};
  assert.equal(taskReward(task,'999','USD').rewardAmount,'17.89');
  assert.equal(taskReward(task,null,'USD').rewardAmount,'17.89');
});
test('unknown price/currency does not become a zero reward',()=>{
  assert.equal(taskReward({quantity:'2',executorShare:'1'},null,'BYN').rewardAmount,null);
  assert.equal(taskReward({quantity:'2',executorShare:'1'},'12',null).rewardAmount,null);
});
test('workspace requires real bindings without deleting or masking financial storage',()=>{
  assert.deepEqual([taskWorkspaceBindings.productId,taskWorkspaceBindings.workId,taskWorkspaceBindings.assigneeId],[{not:null},{not:null},{not:null}]);
  assert.equal('title' in taskWorkspaceBindings,false);assert.equal('legacyTable' in taskWorkspaceBindings,false);
});
test('frozen amount never waives a real live Work Product binding',()=>{
  const project={deletedAt:null},product={deletedAt:null,project};
  const row:FixtureRow={productId:'p',workId:'w',assigneeId:'u',allocationGroupId:'old',shareAmount:'17.89',work:{productId:'p',priceSnapshot:null,product,project}};
  assert.equal(matches(row,taskWorkspaceBindings as FixtureRow),true);
  for(const work of [{...row.work as FixtureRow,productId:null},{...row.work as FixtureRow,product:null},{...row.work as FixtureRow,product:{...product,deletedAt:new Date(0)}},{...row.work as FixtureRow,project:{deletedAt:new Date(0)}}])assert.equal(matches({...row,work},taskWorkspaceBindings as FixtureRow),false);
  assert.equal(row.shareAmount,'17.89');
});
test('coordinate eligibility binds task/work/product without changing historical facts; an empty area denies',async()=>{
  const project:FixtureRow={id:'project',deletedAt:null};
  const product:FixtureRow={id:'product',projectId:'project',project,deletedAt:null,tasks:[]};
  const work:FixtureRow={id:'work',projectId:'project',productId:'product',project,product,priceSnapshot:'0'};
  const task:FixtureRow={id:'task',projectId:'project',productId:'product',workId:'work',assigneeId:'user',work,product,project,allocationGroupId:'old',shareAmount:'17.89'};
  product.tasks=[task];
  const db={product:{findMany:async(args:Parameters<typeof queryRows>[1])=>queryRows([product],args)}} as unknown as Pick<PrismaClient,'product'>;
  const result=await taskWorkspaceEligibility(db,{projectId:'project',productId:'product'});
  assert.equal(matches(task,result as FixtureRow),true);
  for(const changed of [{...task,projectId:'elsewhere'},{...task,productId:'elsewhere'},{...task,work:{...work,projectId:'elsewhere'}},{...task,work:{...work,productId:'elsewhere'}},{...task,product:{...product,projectId:'elsewhere'}}])assert.equal(matches(changed,result as FixtureRow),false);
  assert.equal(task.shareAmount,'17.89');assert.equal(work.priceSnapshot,'0');
  const absent=await taskWorkspaceEligibility(db,{projectId:'absent'});assert.equal(matches(task,absent as FixtureRow),false);
});
