import assert from "node:assert/strict";
import { test } from "node:test";
import { type PrismaClient, type Role, Prisma } from "@prisma/client";
import { listFinanceWorkspaceProjects, getFinanceProjectRef, selectableFinanceProjectsWhere, listFinanceProjectRefs } from "../src/server/finance/project-refs";
import { liveProjectWhere } from "../src/server/access/live-entities";
import { authConfig } from "../src/auth.config";
import { createPaymentCore } from "../src/server/payments/service";
import { createProjectCore } from "../src/server/projects/core";
import { loadFinanceProjectWorkspace } from "../src/server/finance/project-workspace";

{ // Источник: finance-project-workspace.test.ts
const row={id:'j',number:'205',title:'Order',currency:'BYN',stage:'LEAD',deletedAt:null,client:{name:'Client',lastName:null,middleName:null,phone:'SECRET'},description:'SECRET',products:[{description:'SECRET'}],managerId:'secret-manager'};
function fixture(){let reads=0;const inputs:unknown[]=[];const db={project:{findMany:async(input:unknown)=>{reads++;inputs.push(input);return[row];},findFirst:async(input:unknown)=>{reads++;inputs.push(input);return row;}}} as unknown as Pick<PrismaClient,'project'>;return{db,inputs,get reads(){return reads;}};}
test('native query boundary permits finance and role unions but denies nonfinance before any DB read',async()=>{
 const f=fixture();for(const roles of [['ADMIN'],['DIRECTOR'],['ACCOUNTANT'],['PROCUREMENT'],['MANAGER','ACCOUNTANT']] as Role[][]){assert.equal((await listFinanceWorkspaceProjects({id:'u',roles},f.db)).length,1);assert.ok(await getFinanceProjectRef({id:'u',roles},'205',f.db));}
 const before=f.reads;for(const roles of [['MANAGER'],['ENGINEER'],['WORKER'],[]] as Role[][])await assert.rejects(listFinanceWorkspaceProjects({id:'u',roles},f.db),/прав/);assert.equal(f.reads,before);
});
test('public financial metadata is an explicit allowlist even when a DB adapter returns extra fields',async()=>{
 const f=fixture(),actor={id:'a',roles:['ACCOUNTANT' as Role]};const refs=await listFinanceWorkspaceProjects(actor,f.db);assert.deepEqual(Object.keys(refs[0]).sort(),['id','number','title','currency','stage','clientLabel','projectArchived'].sort());assert.ok(!JSON.stringify(refs).includes('SECRET'));assert.ok(!JSON.stringify(refs).includes('secret-manager'));const header=await getFinanceProjectRef(actor,'j',f.db);assert.deepEqual(header,refs[0]);assert.ok(!JSON.stringify(f.inputs).includes('products'));
});
}

// Источник: finance-project-workspace-archived.test.ts
test('picker excludes deleted projects while historical lookup retains an explicit archived flag',async()=>{
 assert.deepEqual(selectableFinanceProjectsWhere(),liveProjectWhere);
 const inputs: Array<{where:unknown}>=[];const row={id:'j',number:'1',title:'Old',currency:'BYN',stage:'LEAD',deletedAt:new Date() as Date|null,client:{name:'C',lastName:null,middleName:null}};
 const db={project:{findMany:async(i:{where:unknown})=>{inputs.push(i);return[row];},findFirst:async(i:{where:unknown})=>{inputs.push(i);return row;}}} as unknown as Pick<PrismaClient,'project'>;
 const actor={id:'a',roles:['ACCOUNTANT' as Role]};const picker=await listFinanceProjectRefs(actor,'',db);assert.deepEqual(Object.keys(picker[0]).sort(),['id','number','title','currency'].sort());assert.deepEqual(inputs[0].where,{AND:[liveProjectWhere,{}]});
 const historic=await getFinanceProjectRef(actor,'j',db);assert.equal(historic?.projectArchived,true);assert.deepEqual(inputs[1].where,{id:'j'});assert.ok(!JSON.stringify(historic).includes('deletedAt'));
 row.deletedAt=null;assert.equal((await getFinanceProjectRef(actor,'j',db))?.projectArchived,false);
});

// Источник: finance-project-workspace-boundaries.test.ts
const actor=(roles:Role[])=>({id:'actor',name:'Actor',roles,source:'web' as const});
test('actual route policy admits finance workspace but keeps accountant outside general projects',()=>{
 const allow=(roles:Role[],pathname:string)=>authConfig.callbacks.authorized({auth:{user:{id:'actor',roles}},request:{nextUrl:new URL(`https://qa.invalid${pathname}`)}} as never);
 assert.equal(allow(['ACCOUNTANT'],'/finance/projects/205'),true);assert.equal(allow(['PROCUREMENT'],'/finance/projects/205'),true);assert.ok(allow(['ACCOUNTANT'],'/projects/205') instanceof Response);assert.ok(allow(['MANAGER'],'/finance/projects/205') instanceof Response);
});
test('reused real money/general creation entrypoints retain their independent role guards',async()=>{
 for(const roles of [['MANAGER'],['ENGINEER'],['WORKER']] as Role[][])await assert.rejects(createPaymentCore(actor(roles),{clientMutationId:'00000134-0000-4000-8000-000000000103',projectId:'j',direction:'INCOME',currency:'BYN',cashAccountId:'cash',amount:1}),/прав/);
 for(const roles of [['ACCOUNTANT'],['PROCUREMENT']] as Role[][])await assert.rejects(createProjectCore(actor(roles),{title:'Must not create',clientId:'client'}),/прав/);
});

{ // Источник: finance-project-workspace-data.test.ts
const metadata={id:'j',number:'205',title:'Financial project',currency:'BYN',stage:'LEAD',deletedAt:null,client:{name:'Client',lastName:null,middleName:null},products:[{description:'SECRET'}]};
const money={currency:'BYN',unavailableReason:'Unknown historical BYN',expectedPrice:null,paidTotal:12,expensesTotal:3,payrollTotal:null,margin:null,marginAtFullPrice:null,expenseBreakdown:[{key:'payroll',label:'Salary',amount:null}]};
function fixture(){let calls=0,priceCalls=0;const captured:unknown[]=[];const invoke=(input:unknown,value:unknown)=>{calls++;captured.push(input);return value;};const db={orgSetting:{findUnique:async(input:unknown)=>invoke(input,{value:JSON.stringify({revision:1,accountId:'cash'})})},stockMovement:{findMany:async(input:unknown)=>invoke(input,[])},project:{findFirst:async(input:unknown)=>invoke(input,metadata)},payment:{findMany:async(input:unknown)=>invoke(input,[{id:'pay',direction:'INCOME',amount:new Prisma.Decimal('4'),currency:'USD',rate:new Prisma.Decimal('3'),bynAmount:new Prisma.Decimal('12'),projectAmount:new Prisma.Decimal('12'),paidAt:new Date('2026-01-01T12:00:00Z'),comment:'Income',createdById:'u',cashAccount:{name:'USD cash'},expenseArticle:null,SECRET:'hidden'}])},cashAccount:{findMany:async(input:unknown)=>invoke(input,[{id:'cash',name:'USD cash',currency:'USD'}])},expenseArticle:{findMany:async(input:unknown)=>invoke(input,[{id:'article',name:'Materials'}])},user:{findMany:async(input:unknown)=>invoke(input,[{id:'u',name:'Creator'}])}} as unknown as Parameters<typeof loadFinanceProjectWorkspace>[2];return{db,captured,get calls(){return calls;},get priceCalls(){return priceCalls;},economics:async()=>{priceCalls++;return money;}};}
test('financial projection retains physical currency and nullable BYN totals without general/technical data',async()=>{const f=fixture();const data=await loadFinanceProjectWorkspace({id:'a',roles:['ACCOUNTANT']},'205',f.db,f.economics);assert.ok(data);assert.equal(data.economics.payrollTotal,null);assert.equal(data.unavailableReason,'Unknown historical BYN');assert.equal(data.payments[0].amount,4);assert.equal(data.payments[0].currency,'USD');assert.equal(data.payments[0].bynAmount,12);assert.equal(data.payments[0].createdByName,'Creator');assert.equal(data.cashAccounts[0].isDefault,true);assert.ok(!JSON.stringify(data).includes('SECRET'));assert.equal(f.priceCalls,1);assert.ok(!JSON.stringify(f.captured).includes('description'));assert.ok(JSON.stringify(f.captured).includes('"active":true'));});
test('direct data loader refuses every nonfinancial role before metadata, economics or ledger read',async()=>{const f=fixture();for(const roles of [['MANAGER'],['ENGINEER'],['WORKER'],[]] as Role[][])await assert.rejects(loadFinanceProjectWorkspace({id:'u',roles},'205',f.db,f.economics),/прав/);assert.equal(f.calls,0);assert.equal(f.priceCalls,0);});
}
