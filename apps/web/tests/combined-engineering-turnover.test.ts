import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import {Prisma} from '@prisma/client';
import {payrollMonth} from '../src/lib/payroll-month';
const require=createRequire(import.meta.url);
function inject(path:string,exports:Record<string,unknown>){const id=require.resolve(path),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports=exports;require.cache[id]=stub;}
type Row=Record<string,unknown>;
const now=payrollMonth(), past='2000-01';
const employee={id:'combined',name:'Combined',roles:['ENGINEER','MANAGER'],payScheme:'PERCENT_TURNOVER',payPercent:new Prisma.Decimal(5)};
const history:Row[]=[{userId:employee.id,scheme:'PRODUCT_PERCENT_ENGINEERING',amount:'150',bynAmount:'150',currency:'BYN',month:past},{userId:employee.id,scheme:'PIECE',amount:'1000',bynAmount:'1000',currency:'BYN',month:past}];
const payouts=[{userId:employee.id,amount:'100',bynAmount:'100',payrollCurrency:'BYN'}];
let findScope:Row|null=null;
const database={user:{findMany:async({where}:{where:Row})=>{findScope=where;return [employee];}},payrollEntry:{findMany:async({where}:{where?:Row})=>history.filter(row=>!where||Object.entries(where).every(([key,value])=>key==='userId'?true:key==='month'&&value&&typeof value==='object'&&'lt' in value?String(row.month)<String(value.lt):row[key]===value)),create:async({data}:{data:Row})=>{const row={id:'turnover',...data};history.push(row);return row;}},payout:{findMany:async()=>payouts},payment:{aggregate:async()=>({_sum:{bynAmount:2000},_count:{_all:1}})}};
Object.assign(database,{changeLog:{create:async()=>({id:'audit'})},domainEvent:{create:async()=>({id:'event'})}});
inject('../src/server/tasks/transaction',{withTaskTransaction:async(operation:(tx:import('@prisma/client').Prisma.TransactionClient)=>Promise<unknown>)=>operation(database as unknown as import('@prisma/client').Prisma.TransactionClient)});
inject('../src/lib/prisma',{prisma:database});
inject('next/cache',{revalidatePath:()=>{}});
inject('../src/server/require-role',{requireFinance:async()=>({user:{id:'accountant',name:'Accountant',roles:['ACCOUNTANT']}})});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});
inject('../src/server/plugins/events',{emitDomainEvent:async()=>{},dispatchEvent:async()=>{}});
inject('../src/server/notifications/notify',{notifyPerson:async()=>{},notifyOrg:async()=>{}});
const {accrueTurnover}=require('../src/server/payroll/actions') as typeof import('../src/server/payroll/actions');
const {getEmployeeDues,getCurrentMonthEstimates}=require('../src/server/payroll/queries') as typeof import('../src/server/payroll/queries');
test('combined chosen turnover accrues on top of frozen engineering and piece history, replay does not duplicate',async()=>{
 const original=JSON.stringify(history);const result=await accrueTurnover(past);assert.equal(result.ok,true);assert.equal(result.accruedCount,1);
 assert.equal(history.at(-1)?.scheme,'PERCENT_TURNOVER');assert.equal(new Prisma.Decimal(String(history.at(-1)?.amount)).toNumber(),100);assert.equal(history.at(-1)?.currency,'BYN');assert.equal(JSON.stringify(history.slice(0,2)),original);
 assert.ok(findScope);assert.equal(Object.hasOwn(findScope,'roles'),false);
 assert.equal((await accrueTurnover(past)).accruedCount,0);assert.equal(history.length,3);
 assert.equal(employee.payScheme,'PERCENT_TURNOVER');
});
test('combined ordinary plus engineering current month remains estimate; debt excludes current and deducts all payouts',async()=>{
 history.push({userId:employee.id,scheme:'PRODUCT_PERCENT_ENGINEERING',amount:'50',bynAmount:'50',currency:'BYN',month:now},{userId:employee.id,scheme:'PIECE',amount:'25',bynAmount:'25',currency:'BYN',month:now});
 assert.deepEqual(await getCurrentMonthEstimates(),{combined:75});
 assert.deepEqual(await getEmployeeDues(),[{userId:'combined',name:'Combined',due:1150}]);
 const count=history.length;assert.equal((await accrueTurnover(now)).ok,false);assert.equal(history.length,count);
});

test('pure ENGINEER stored turnover scheme cannot create new ordinary accrual or preview; prior debt remains',async()=>{
 employee.roles=['ENGINEER'];
 const before=JSON.stringify(history);const result=await accrueTurnover(past);assert.equal(result.ok,false);assert.equal(JSON.stringify(history),before);
 const {getTurnoverAccruals}=require('../src/server/payroll/queries') as typeof import('../src/server/payroll/queries');
 assert.deepEqual(await getTurnoverAccruals(past),[]);assert.deepEqual(await getEmployeeDues(),[{userId:'combined',name:'Combined',due:1150}]);
});
