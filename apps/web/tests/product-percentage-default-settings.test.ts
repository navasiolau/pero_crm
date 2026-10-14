import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { type Prisma } from "@prisma/client";
import { readProductPercentageDefaults, saveProductPercentageDefaults } from "../src/server/product-percentage-defaults/core";
import { DEFAULT_PERCENTAGE_KEY, EMPTY_DEFAULTS, defaultsPatchSchema } from "../src/server/product-percentage-defaults/contracts";
import { canAccessSettingsPath, PRODUCT_PERCENTAGE_SETTINGS_PATH } from "../src/lib/settings-access";
import { navItemsForRole } from "../src/lib/nav";
import { NextRequest } from "next/server";
import { authConfig } from "../src/auth.config";
import { createProductCore } from "../src/server/products/core";
import { type TaskTransaction } from "../src/server/tasks/transaction";

{ // Источник: product-percentage-default-settings.test.ts
const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function fixture(){let row:{value:string}|null=null;const audit=new Map<string,Prisma.JsonValue>();const facts={oldProduct:{id:'old'},payroll:{amount:'150'}};let writes=0,auditFails=false;
 const tx={orgSetting:{findUnique:async()=>row,upsert:async({create}:{create:{value:string}})=>{row={value:create.value};writes++;return row;}},changeLog:{findUnique:async({where}:{where:{id:string}})=>audit.get(where.id)??null,create:async({data}:{data:Prisma.ChangeLogCreateInput})=>{if(auditFails)throw Error('audit-failed');audit.set(String(data.id),data as unknown as Prisma.JsonValue);return data;}}} as unknown as Prisma.TransactionClient;
 return{tx,facts,audit,get writes(){return writes;},set(value:string){row={value};},failAudit:()=>{auditFails=true;},snapshot:()=>structuredClone(row),restore:(before:typeof row)=>{row=before;}};
}
test('missing defaults read as nulls; saves require digits, explicit zero and 0.01 remain distinct and bounded',async()=>{const f=fixture();assert.deepEqual(await readProductPercentageDefaults(f.tx),EMPTY_DEFAULTS);for(const value of ['-1','100.1','5.255','NaN','1e1',''])assert.equal(defaultsPatchSchema.safeParse({rates:{ENGINEERING:value,ASSEMBLY:'0',INSTALLATION:'0.00'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()}).success,false);for(const value of ['1.25','5.1','0','15.00'])assert.equal(defaultsPatchSchema.safeParse({rates:{ENGINEERING:value,ASSEMBLY:'0',INSTALLATION:'0.00'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()}).success,true);assert.equal(defaultsPatchSchema.safeParse({rates:{ENGINEERING:'5',ASSEMBLY:null,INSTALLATION:'0'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()}).success,false);});
test('manager union settings CAS/audit/replay affect no historical product or payroll',async()=>{const f=fixture(),before=structuredClone(f.facts),id=randomUUID(),input={rates:{ENGINEERING:'5.1',ASSEMBLY:'0',INSTALLATION:'0'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:id};const saved=await saveProductPercentageDefaults(actor,input,f.tx);assert.equal(saved.ok,true);assert.deepEqual((await readProductPercentageDefaults(f.tx)).rates,{ENGINEERING:'5.10',ASSEMBLY:'0.00',INSTALLATION:'0.00'});assert.equal(f.audit.size,1);assert.equal((await saveProductPercentageDefaults(actor,input,f.tx)).ok,true);assert.equal(f.writes,1);assert.deepEqual(f.facts,before);const conflict=await saveProductPercentageDefaults(actor,{...input,clientMutationId:randomUUID()},f.tx);assert.equal(conflict.kind,'conflict');});
test('nonmanagement and foreign receipt actor refuse before a settings write; malformed stored value never guessed',async()=>{const f=fixture();const input={rates:EMPTY_DEFAULTS.rates,expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()};assert.equal((await saveProductPercentageDefaults({...actor,roles:['ENGINEER']},input,f.tx)).kind,'forbidden');assert.equal(f.writes,0);f.set('BYN');await assert.rejects(readProductPercentageDefaults(f.tx),/настройки/i);assert.equal(DEFAULT_PERCENTAGE_KEY,'productPercentageDefaults');});
test('no-op has no settings or audit write; role union saves but another actor cannot replay receipt',async()=>{
 const f=fixture(),zeros={rates:{ENGINEERING:'0',ASSEMBLY:'0',INSTALLATION:'0'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()};
 const first=await saveProductPercentageDefaults(actor,zeros,f.tx);assert.equal(first.ok,true);assert.equal(f.writes,1);assert.equal(f.audit.size,1);
 assert.ok(first.ok&&!first.noOp);
 const current=await readProductPercentageDefaults(f.tx);
 const same={rates:{ENGINEERING:'0',ASSEMBLY:'0',INSTALLATION:'0'},expectedRates:current.rates,expectedRevision:current.revision,clientMutationId:randomUUID()};
 const noop=await saveProductPercentageDefaults(actor,same,f.tx);assert.equal(noop.ok,true);assert.equal(f.writes,1);assert.equal(f.audit.size,1);
  const changed={rates:{ENGINEERING:'5',ASSEMBLY:'0',INSTALLATION:'0'},expectedRates:current.rates,expectedRevision:current.revision,clientMutationId:randomUUID()};
  assert.equal((await saveProductPercentageDefaults({...actor,roles:['ENGINEER','MANAGER']},changed,f.tx)).ok,true);
  assert.equal((await saveProductPercentageDefaults({...actor,id:'other-manager'},changed,f.tx)).kind,'validation');assert.equal(f.writes,2);
});
test('audit error escapes the domain callback so transaction rolls settings back rather than returning success',async()=>{
  const f=fixture(),before=f.snapshot();f.failAudit();
  await assert.rejects((async()=>{try{return await saveProductPercentageDefaults(actor,{rates:{ENGINEERING:'5',ASSEMBLY:'0',INSTALLATION:'0'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()},f.tx);}catch(error){f.restore(before);throw error;}})(),/audit-failed/);
  assert.deepEqual(await readProductPercentageDefaults(f.tx),EMPTY_DEFAULTS);
});
test('старый снапшот с 1 знаком валиден и читается как 2 знака; 1.25 сохраняется и считается',async()=>{
  const f=fixture();
  f.set(JSON.stringify({revision:1,rates:{ENGINEERING:'5.1',ASSEMBLY:'0.0',INSTALLATION:null}}));
  assert.deepEqual((await readProductPercentageDefaults(f.tx)).rates,{ENGINEERING:'5.10',ASSEMBLY:'0.00',INSTALLATION:null});
  const g=fixture(),input={rates:{ENGINEERING:'1.25',ASSEMBLY:'0',INSTALLATION:'0.00'},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()};
  const saved=await saveProductPercentageDefaults(actor,input,g.tx);assert.equal(saved.ok,true);
  if(saved.ok)assert.deepEqual(saved.snapshot.rates,{ENGINEERING:'1.25',ASSEMBLY:'0.00',INSTALLATION:'0.00'});
});
}

// Источник: product-percentage-default-access.test.ts
test('manager exact percentage route does not grant any other admin settings',()=>{assert.equal(canAccessSettingsPath(['MANAGER'],PRODUCT_PERCENTAGE_SETTINGS_PATH),true);assert.equal(canAccessSettingsPath(['MANAGER','ENGINEER'],PRODUCT_PERCENTAGE_SETTINGS_PATH+'/'),true);assert.equal(canAccessSettingsPath(['MANAGER'],'/settings'),true);for(const path of ['/settings/users','/settings/payroll','/settings/modules','/settings/api',PRODUCT_PERCENTAGE_SETTINGS_PATH+'/users',PRODUCT_PERCENTAGE_SETTINGS_PATH+'-other'])assert.equal(canAccessSettingsPath(['MANAGER'],path),false);for(const roles of [['ENGINEER'],['ACCOUNTANT'],['WORKER'],[]] as Parameters<typeof canAccessSettingsPath>[0][])assert.equal(canAccessSettingsPath(roles,PRODUCT_PERCENTAGE_SETTINGS_PATH),false);assert.equal(canAccessSettingsPath(['ADMIN'],'/settings/users'),true);assert.ok(!navItemsForRole(['MANAGER']).some(row=>row.href===PRODUCT_PERCENTAGE_SETTINGS_PATH));assert.ok(navItemsForRole(['MANAGER']).some(row=>row.href==='/settings'));});
test('actual auth route callback permits only the new manager settings path, retaining finance and administrator boundaries',()=>{
 const auth={user:{id:'manager',sessionVersion:0,roles:['MANAGER' as const]},expires:'2099-01-01'};
 assert.equal(authConfig.callbacks.authorized({auth,request:new NextRequest(`http://example.invalid${PRODUCT_PERCENTAGE_SETTINGS_PATH}`)}),true);
 assert.equal(authConfig.callbacks.authorized({auth,request:new NextRequest('http://example.invalid/settings')}),true);
 for(const path of ['/settings/users','/settings/payroll','/settings/modules','/settings/api','/changelog','/finance']){
  const result=authConfig.callbacks.authorized({auth,request:new NextRequest(`http://example.invalid${path}`)});
  assert.ok(result instanceof Response);assert.equal(result.headers.get('location'),'http://example.invalid/');
 }
});

{ // Источник: product-percentage-default-create.test.ts
const actor={id:'m',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
test('new products initialize all three rates from one snapshot even without assignments; prior products remain independent',async()=>{
  let rates={revision:2,rates:{ENGINEERING:'5.10',ASSEMBLY:'0.00',INSTALLATION:null as string|null}},reads=0;const created:Prisma.ProductCreateInput[]=[],old={rate:'9.0',paid:'150'};
  const tx={$queryRaw:async()=>[],project:{findUnique:async()=>({id:'j',number:'1',currency:'BYN',stage:'CONTRACT'})},user:{findFirst:async()=>null},orgSetting:{findUnique:async()=>{reads++;return{value:JSON.stringify(rates)}}},product:{findMany:async()=>[],aggregate:async()=>({_max:{suffixInt:0}}),create:async({data}:{data:Prisma.ProductCreateInput})=>{created.push(data);return{id:`p${created.length}`,initialPrice:null,...data}}},changeLog:{create:async()=>({})}} as unknown as Prisma.TransactionClient;
  const transaction:TaskTransaction=fn=>fn(tx);assert.equal((await createProductCore(actor,{projectId:'j',title:'Product'},transaction)).ok,true);
  assert.equal(created[0].status,'PREPARATION');assert.equal((created[0].statusHistory?.create as {toStatus:string}).toStatus,'PREPARATION');
  const first=created[0].percentageConfigs?.create as {kind:string;ratePercent:string|null;revision:number}[];assert.deepEqual(first.map(row=>[row.kind,row.ratePercent,row.revision]),[['ENGINEERING','5.10',1],['ASSEMBLY','0.00',1],['INSTALLATION','0.00',1]]);assert.equal(reads,1);
  rates={revision:3,rates:{ENGINEERING:'6.00',ASSEMBLY:'4.00',INSTALLATION:'7.00'}};await createProductCore(actor,{projectId:'j',title:'Next'},transaction);assert.equal(reads,2);assert.deepEqual(first.map(row=>row.ratePercent),['5.10','0.00','0.00']);assert.deepEqual(old,{rate:'9.0',paid:'150'});
});
test('missing setting initializes zero configs; corrupt or foreign money defaults never leave a partial product',async()=>{
 let value:string|null=null,currency='BYN';const created:Prisma.ProductCreateInput[]=[];
 const tx={$queryRaw:async()=>[],project:{findUnique:async()=>({id:'j',number:'1',currency,stage:'CONTRACT'})},orgSetting:{findUnique:async()=>value===null?null:{value}},product:{findMany:async()=>[],create:async({data}:{data:Prisma.ProductCreateInput})=>{created.push(data);return{id:'p',initialPrice:null,...data};}},changeLog:{create:async()=>({})}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=fn=>fn(tx);
 assert.equal((await createProductCore(actor,{projectId:'j',title:'No defaults'},transaction)).ok,true);
  assert.deepEqual((created[0].percentageConfigs?.create as {ratePercent:string|null}[]).map(row=>row.ratePercent),['0.00','0.00','0.00']);
 value='corrupt';await assert.rejects(createProductCore(actor,{projectId:'j',title:'Corrupt'},transaction),/настройки/i);assert.equal(created.length,1);
 value=JSON.stringify({revision:1,rates:{ENGINEERING:'5',ASSEMBLY:null,INSTALLATION:null}});currency='USD';assert.equal((await createProductCore(actor,{projectId:'j',title:'Foreign'},transaction)).ok,false);assert.equal(created.length,1);
});
}
