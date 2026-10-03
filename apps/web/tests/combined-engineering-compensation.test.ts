import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma,type Role} from '@prisma/client';
import {changeTaskStatusCore} from '../src/server/tasks/completion-core';
import {captureProductPercentageCompletion} from '../src/server/product-percentage-pay/core';
import {historicalTaskAllocation,taskShareFixture} from './helpers/task-share-fixture';
import type {DomainActor} from '../src/server/projects/core';
const manager:DomainActor={id:'manager',name:'Manager',roles:['MANAGER'],source:'web'};
type Row=Record<string,unknown>;
function combinedFixture(roles:Role[],payScheme:string){
 const fixture=taskShareFixture('DESIGN');
 const recipient=fixture.state().users.find(row=>row.id==='worker')!;Object.assign(recipient,{roles,payScheme});
 fixture.state().products[0].engineerId='worker';
 const snapshots:Row[]=[],shares:Row[]=[];
 let price='1000.01',rate='5';
 const capture=()=>fixture.transaction(async tx=>{
 const percentageTx={...tx,
 product:{findUnique:async()=>({id:'product',projectId:'project',number:'1.1',quantity:3,expectedPrice:new Prisma.Decimal(price),project:{currency:fixture.state().projectCurrency},engineer:recipient,percentageConfigs:[{revision:1,ratePercent:new Prisma.Decimal(rate)}],stagePayPools:[]})},
 productPercentageCompletion:{findUnique:async()=>snapshots[0]??null,create:async({data}:{data:Row})=>{const row={id:'completion',...data};snapshots.push(row);return row;}},
 productPercentageCompletionShare:{create:async({data}:{data:Row})=>{const row={id:'percentage-share',...data};shares.push(row);return row;}},
 } as unknown as Prisma.TransactionClient;
 return captureProductPercentageCompletion(percentageTx,manager,'product','ENGINEERING','PRODUCTION');
 });
 return {fixture,snapshots,shares,capture,changePriceAndRate:()=>{price='9999';rate='90';}};
}
test('ENGINEER+MANAGER chosen PIECE plus independent engineering percentage in either role order, with exact snapshots/replay',async()=>{
 for(const roles of [['ENGINEER','MANAGER'],['MANAGER','ENGINEER']] as Role[][]){
 const f=combinedFixture(roles,'PIECE');
 const result=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);
 assert.ok(result.ok);assert.equal(result.payroll?.amount,'1000.00');
 assert.equal(await f.capture(),'SETTLED');
 const entries=f.fixture.state().entries;
 assert.deepEqual(entries.map(row=>[row.scheme,row.amount,row.currency]),[['PIECE','1000.00','BYN'],['PRODUCT_PERCENT_ENGINEERING','150.00','BYN']]);
 assert.ok(entries.every(row=>row.userId==='worker'));assert.equal(f.snapshots[0].calculationVersion,2);assert.equal(f.snapshots[0].quantitySnapshot,3);
 assert.equal(String(f.snapshots[0].totalSnapshot),'3000.03');assert.equal(String(f.snapshots[0].ratePercentSnapshot),'5');
 const immutable=JSON.stringify({entries,snapshots:f.snapshots,shares:f.shares});
 f.changePriceAndRate();assert.equal(await f.capture(),'SETTLED');
 const again=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);assert.ok(again.ok&&again.repeated);
 assert.equal(JSON.stringify({entries:f.fixture.state().entries,snapshots:f.snapshots,shares:f.shares}),immutable);
 assert.equal(entries.filter(row=>row.scheme==='PERCENT_PROJECT').length,0);
 assert.equal(f.fixture.state().users.find(row=>row.id==='worker')!.payScheme,'PIECE');
 }
});
test('engineering percentage remains independent of chosen NONE or TURNOVER scheme, without synthetic task PIECE',async()=>{
 for(const payScheme of ['NONE','PERCENT_TURNOVER']){
 const f=combinedFixture(['ENGINEER','MANAGER'],payScheme);
 const result=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);assert.ok(result.ok);assert.equal(result.payroll,null);
 assert.equal(await f.capture(),'SETTLED');assert.deepEqual(f.fixture.state().entries.map(row=>row.scheme),['PRODUCT_PERCENT_ENGINEERING']);
 assert.equal(f.fixture.state().entries[0].amount,'150.00');assert.equal(f.fixture.state().users.find(row=>row.id==='worker')!.payScheme,payScheme);
 }
});
test('combined role does not weaken photo/dependency/currency or produce engineering payment on malformed source',async()=>{
 const missingPhoto=combinedFixture(['ENGINEER','MANAGER'],'PIECE');missingPhoto.fixture.state().files.length=0;
 const before=structuredClone(missingPhoto.fixture.state());assert.equal((await changeTaskStatusCore(manager,'source','DONE',20,missingPhoto.fixture.transaction)).ok,false);assert.deepEqual(missingPhoto.fixture.state(),before);
 const foreign=combinedFixture(['ENGINEER','MANAGER'],'PIECE');foreign.fixture.state().projectCurrency='USD';await assert.rejects(foreign.capture(),/BYN/);assert.equal(foreign.fixture.state().entries.length,0);assert.equal(foreign.snapshots.length,0);
});

test('pure ENGINEER does not accrue a new ordinary PIECE but keeps product engineering snapshot',async()=>{
 const f=combinedFixture(['ENGINEER'],'PIECE');
 f.fixture.state().entries.push({id:'old-pay',userId:'worker',scheme:'PIECE',amount:'12.34',bynAmount:'12.34',currency:'BYN',month:'2000-01'});
 const history=JSON.stringify(f.fixture.state().entries);
 const result=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);assert.ok(result.ok);assert.equal(result.payroll,null);
 assert.equal(JSON.stringify(f.fixture.state().entries),history);
 assert.equal(await f.capture(),'SETTLED');assert.equal(f.fixture.state().entries.at(-1)?.scheme,'PRODUCT_PERCENT_ENGINEERING');
 assert.equal(f.fixture.state().entries.at(-1)?.amount,'150.00');
});

test('pure ENGINEER keeps valid old TASK_FIXED monetary obligation unchanged despite changed/null current unit price',async()=>{
 for(const priceSnapshot of ['9999.99',null]){
 const f=combinedFixture(['ENGINEER'],'PIECE');historicalTaskAllocation(f.fixture);
 f.fixture.state().works[0].priceSnapshot=priceSnapshot;
 const frozen=JSON.stringify({group:f.fixture.state().groups[0],shareAmount:f.fixture.state().tasks[0].shareAmount,shareUnits:f.fixture.state().tasks[0].shareUnits});
 const result=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);assert.ok(result.ok);assert.equal(result.payroll?.amount,'700.00');
 assert.deepEqual(f.fixture.state().entries.map(row=>[row.scheme,row.amount]),[['PIECE','700.00']]);
 assert.equal(JSON.stringify({group:f.fixture.state().groups[0],shareAmount:f.fixture.state().tasks[0].shareAmount,shareUnits:f.fixture.state().tasks[0].shareUnits}),frozen);
 assert.ok((await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction)).ok);assert.equal(f.fixture.state().entries.length,1);
 }
});
test('pure ENGINEER is not granted ordinary salary by physical/stage/corrupted/nonmonetary legacy markers',async()=>{
 for(const mode of ['physical','preview','missing-budget','invalid-money','over-budget','bad-units','wrong-work','group-only','coefficient-only']){
 const f=combinedFixture(['ENGINEER'],'PIECE');historicalTaskAllocation(f.fixture);const task=f.fixture.state().tasks[0],group=f.fixture.state().groups[0];
 if(mode==='physical'){group.budgetSource='PHYSICAL_ONLY';task.physicalOnlyShare=true;}
 if(mode==='preview')group.budgetSource='STAGE_PREVIEW';if(mode==='missing-budget')group.budget=null;
 if(mode==='invalid-money')task.shareAmount='NaN';if(mode==='over-budget')task.shareAmount='1000.01';if(mode==='bad-units')task.shareUnits=0;
 if(mode==='wrong-work')group.workId='foreign';if(mode==='group-only')task.shareAmount=null;
 if(mode==='coefficient-only'){task.allocationGroupId=null;task.shareAmount=null;task.shareUnits=null;task.executorShare='0.5';}
 const result=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);assert.ok(result.ok,mode);assert.equal(result.payroll,null,mode);assert.equal(f.fixture.state().entries.length,0,mode);
 }
});
test('existing historical PIECE entry is neither recalculated nor duplicated when old obligation finishes',async()=>{
 const f=combinedFixture(['ENGINEER'],'PIECE');historicalTaskAllocation(f.fixture);
 f.fixture.state().entries.push({id:'paid-before',userId:'worker',taskId:'source',scheme:'PIECE',amount:'700.00',bynAmount:'700.00',currency:'BYN',month:'2000-01'});
 const original=JSON.stringify(f.fixture.state().entries);const result=await changeTaskStatusCore(manager,'source','DONE',20,f.fixture.transaction);
 assert.ok(result.ok);assert.equal(result.payroll,null);assert.equal(JSON.stringify(f.fixture.state().entries),original);
});