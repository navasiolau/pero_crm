import assert from 'node:assert/strict';
import test from 'node:test';
import type {PrismaClient,Role} from '@prisma/client';
import {listFinanceWorkspaceProjects,getFinanceProjectRef} from '../src/server/finance/project-refs';
const row={id:'j',number:'205',title:'Order',currency:'BYN',stage:'LEAD',deletedAt:null,client:{name:'Client',lastName:null,middleName:null,phone:'SECRET'},description:'SECRET',products:[{description:'SECRET'}],managerId:'secret-manager'};
function fixture(){let reads=0;const inputs:unknown[]=[];const db={project:{findMany:async(input:unknown)=>{reads++;inputs.push(input);return[row];},findFirst:async(input:unknown)=>{reads++;inputs.push(input);return row;}}} as unknown as Pick<PrismaClient,'project'>;return{db,inputs,get reads(){return reads;}};}
test('native query boundary permits finance and role unions but denies nonfinance before any DB read',async()=>{
 const f=fixture();for(const roles of [['ADMIN'],['DIRECTOR'],['ACCOUNTANT'],['PROCUREMENT'],['MANAGER','ACCOUNTANT']] as Role[][]){assert.equal((await listFinanceWorkspaceProjects({id:'u',roles},f.db)).length,1);assert.ok(await getFinanceProjectRef({id:'u',roles},'205',f.db));}
 const before=f.reads;for(const roles of [['MANAGER'],['ENGINEER'],['WORKER'],[]] as Role[][])await assert.rejects(listFinanceWorkspaceProjects({id:'u',roles},f.db),/прав/);assert.equal(f.reads,before);
});
test('public financial metadata is an explicit allowlist even when a DB adapter returns extra fields',async()=>{
 const f=fixture(),actor={id:'a',roles:['ACCOUNTANT' as Role]};const refs=await listFinanceWorkspaceProjects(actor,f.db);assert.deepEqual(Object.keys(refs[0]).sort(),['id','number','title','currency','stage','clientLabel','projectArchived'].sort());assert.ok(!JSON.stringify(refs).includes('SECRET'));assert.ok(!JSON.stringify(refs).includes('secret-manager'));const header=await getFinanceProjectRef(actor,'j',f.db);assert.deepEqual(header,refs[0]);assert.ok(!JSON.stringify(f.inputs).includes('products'));
});
