import assert from 'node:assert/strict';
import {before,beforeEach,test} from 'node:test';
import {createRequire,Module} from 'node:module';
import type {PrismaClient,Role} from '@prisma/client';
const require=createRequire(import.meta.url);let roles:Role[]=['PROCUREMENT'],calls=0;
const db={
 task:{findMany:async()=>[]},
 $queryRaw:async()=>{calls++;return[];}, $transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn(db),
 materialCategory:{create:async({data}:{data:object})=>{calls++;return{id:'category',...data};}},
 material:{findMany:async()=>{calls++;return[{id:'material',name:'M',sku:null,unit:'шт.',categoryId:null,category:null,purchasePrice:12.34,minStock:null,active:true,comment:null}];}},
 stockMovement:{groupBy:async()=>[],findMany:async()=>{calls++;return[];}},
 projectMaterial:{findMany:async()=>[],findUnique:async()=>{calls++;return null;}},
 project:{findMany:async()=>{calls++;return[{id:'project',number:'1',title:'Finance project',currency:'USD',stage:'PRODUCTION',description:'SECRET_TECH',client:{phone:'SECRET_CONTACT'}}];}},
 };
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let actions:typeof import('../src/server/warehouse/actions'),queries:typeof import('../src/server/warehouse/queries'),refs:typeof import('../src/server/finance/project-refs'),api:typeof import('../src/app/api/finance/projects/route'),filePermission:typeof import('../src/server/files/delete-permission');
before(()=>{
 (globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;
 inject('../src/auth',{auth:async()=>({user:{id:'actor',name:'Actor',roles}})});
 inject('next/cache',{revalidatePath(){}});inject('../src/server/plugins/changelog',{writeChangeLog:async()=>({})});inject('../src/server/plugins/events',{emitDomainEvent:async()=>{},dispatchEvent:async()=>{}});inject('../src/server/notifications/notify',{notifyOrg:async()=>{},notifyPerson:async()=>{}});
 actions=require('../src/server/warehouse/actions');queries=require('../src/server/warehouse/queries');refs=require('../src/server/finance/project-refs');api=require('../src/app/api/finance/projects/route');filePermission=require('../src/server/files/delete-permission');
});
beforeEach(()=>{calls=0;roles=['PROCUREMENT'];});
test('actual warehouse actions let procurement manage catalog and reach issue/return but never change requirements',async()=>{
 assert.equal((await actions.addMaterialCategory({name:'Category'})).ok,true);assert.equal(calls,1);
 for(const fn of [()=>actions.addProjectMaterial({productId:'p',materialId:'m',quantity:1}),()=>actions.updateProjectMaterial({id:'line',quantity:1}),()=>actions.deleteProjectMaterial('line')]){const before:number=calls;await assert.rejects(fn,/Недостаточно прав/);assert.equal(calls,before);}
 for(const fn of [()=>actions.requestMaterial({projectMaterialId:'line',quantity:1}),()=>actions.returnMaterial({projectMaterialId:'line',quantity:1})]){const before:number=calls;const result=await fn();assert.equal(result.ok,false);assert.notEqual(result.error,'Недостаточно прав');assert.ok(calls>before,'authorized operation must reach scoped line lookup');}
 roles=['ACCOUNTANT'];await assert.rejects(()=>actions.addMaterialCategory({name:'No'}),/Недостаточно прав/);
});
test('actual warehouse queries deny accountant before lookup and project cost fields by independent money grant',async()=>{
 await assert.rejects(()=>queries.listMaterials({id:'actor',roles:['ACCOUNTANT']}),/Недостаточно прав/);await assert.rejects(()=>queries.listMovements({id:'actor',roles:['ACCOUNTANT']}),/Недостаточно прав/);assert.equal(calls,0);
 assert.equal((await queries.listMaterials({id:'actor',roles:['PROCUREMENT']}))[0].purchasePrice,12.34);assert.equal((await queries.listMaterials({id:'actor',roles:['MANAGER']}))[0].purchasePrice,null);
});
test('real financial reference API retains ledger currency and excludes operational DTO even from broad adapter rows',async()=>{
 roles=['ACCOUNTANT'];const response=await api.GET(new Request('https://qa.invalid/api/finance/projects?q=1'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{projects:[{id:'project',number:'1',title:'Finance project',currency:'USD'}]});
 const before:number=calls;roles=['MANAGER'];assert.equal((await api.GET(new Request('https://qa.invalid/api/finance/projects'))).status,403);assert.equal(calls,before);
 roles=['PROCUREMENT'];assert.equal((await refs.listFinanceProjectRefs({roles}))[0].currency,'USD');
});
test('prior uploader ownership never gives readonly procurement/accountant technical file deletion rights',async()=>{
 for(const role of ['ACCOUNTANT','PROCUREMENT'] as Role[]){assert.equal(await filePermission.mayDeleteStoredFile(db as never,{id:'actor',roles:[role]},{uploadedById:'actor',projectId:'p',productId:'product',taskId:null}),false);}
});
