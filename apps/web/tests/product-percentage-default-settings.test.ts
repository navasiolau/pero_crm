import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {readProductPercentageDefaults,saveProductPercentageDefaults} from '../src/server/product-percentage-defaults/core';
import {DEFAULT_PERCENTAGE_KEY,EMPTY_DEFAULTS,defaultsPatchSchema} from '../src/server/product-percentage-defaults/contracts';
const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function fixture(){let row:{value:string}|null=null;const audit=new Map<string,Prisma.JsonValue>();const facts={oldProduct:{id:'old'},payroll:{amount:'150'}};let writes=0,auditFails=false;
 const tx={orgSetting:{findUnique:async()=>row,upsert:async({create}:{create:{value:string}})=>{row={value:create.value};writes++;return row;}},changeLog:{findUnique:async({where}:{where:{id:string}})=>audit.get(where.id)??null,create:async({data}:{data:Prisma.ChangeLogCreateInput})=>{if(auditFails)throw Error('audit-failed');audit.set(String(data.id),data as unknown as Prisma.JsonValue);return data;}}} as unknown as Prisma.TransactionClient;
 return{tx,facts,audit,get writes(){return writes;},set(value:string){row={value};},failAudit:()=>{auditFails=true;},snapshot:()=>structuredClone(row),restore:(before:typeof row)=>{row=before;}};
}
test('missing defaults mean three nulls; explicit zero and 0.1 remain distinct and bounded',async()=>{const f=fixture();assert.deepEqual(await readProductPercentageDefaults(f.tx),EMPTY_DEFAULTS);for(const value of ['-1','100.1','5.25','NaN','1e1'])assert.equal(defaultsPatchSchema.safeParse({rates:{ENGINEERING:value,ASSEMBLY:null,INSTALLATION:null},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()}).success,false);});
test('manager union settings CAS/audit/replay affect no historical product or payroll',async()=>{const f=fixture(),before=structuredClone(f.facts),id=randomUUID(),input={rates:{ENGINEERING:'5.1',ASSEMBLY:'0',INSTALLATION:null},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:id};const saved=await saveProductPercentageDefaults(actor,input,f.tx);assert.equal(saved.ok,true);assert.deepEqual((await readProductPercentageDefaults(f.tx)).rates,{ENGINEERING:'5.1',ASSEMBLY:'0.0',INSTALLATION:null});assert.equal(f.audit.size,1);assert.equal((await saveProductPercentageDefaults(actor,input,f.tx)).ok,true);assert.equal(f.writes,1);assert.deepEqual(f.facts,before);const conflict=await saveProductPercentageDefaults(actor,{...input,clientMutationId:randomUUID()},f.tx);assert.equal(conflict.kind,'conflict');});
test('nonmanagement and foreign receipt actor refuse before a settings write; malformed stored value never guessed',async()=>{const f=fixture();const input={rates:EMPTY_DEFAULTS.rates,expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()};assert.equal((await saveProductPercentageDefaults({...actor,roles:['ENGINEER']},input,f.tx)).kind,'forbidden');assert.equal(f.writes,0);f.set('BYN');await assert.rejects(readProductPercentageDefaults(f.tx),/настройки/i);assert.equal(DEFAULT_PERCENTAGE_KEY,'productPercentageDefaults');});
test('no-op has no settings or audit write; role union saves but another actor cannot replay receipt',async()=>{
 const f=fixture(),input={rates:EMPTY_DEFAULTS.rates,expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()};
 assert.equal((await saveProductPercentageDefaults(actor,input,f.tx)).ok,true);assert.equal(f.writes,0);assert.equal(f.audit.size,0);
 const changed={...input,rates:{ENGINEERING:'5',ASSEMBLY:null,INSTALLATION:null}};
 assert.equal((await saveProductPercentageDefaults({...actor,roles:['ENGINEER','MANAGER']},changed,f.tx)).ok,true);
 assert.equal((await saveProductPercentageDefaults({...actor,id:'other-manager'},changed,f.tx)).kind,'validation');assert.equal(f.writes,1);
});
test('audit error escapes the domain callback so transaction rolls settings back rather than returning success',async()=>{
 const f=fixture(),before=f.snapshot();f.failAudit();
 await assert.rejects((async()=>{try{return await saveProductPercentageDefaults(actor,{rates:{ENGINEERING:'5',ASSEMBLY:null,INSTALLATION:null},expectedRates:EMPTY_DEFAULTS.rates,expectedRevision:0,clientMutationId:randomUUID()},f.tx);}catch(error){f.restore(before);throw error;}})(),/audit-failed/);
 assert.deepEqual(await readProductPercentageDefaults(f.tx),EMPTY_DEFAULTS);
});
