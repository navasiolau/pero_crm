import assert from 'node:assert/strict';
import {before,beforeEach,test} from 'node:test';
import {createRequire,Module} from 'node:module';
import type {PrismaClient,Role} from '@prisma/client';
import {matches} from './helpers/visibility-fixture';
const require=createRequire(import.meta.url);const input={projectId:'j',productId:'p',priceItemId:'tariff',quantityPerUnit:.25};
let listWorkPriceOptions:typeof import('../src/server/works/queries').listWorkPriceOptions;
let state=initial(),inTx=false;let actions:typeof import('../src/server/works/actions');
function initial(){return{actor:{id:'a',name:'Actor',roles:['WORKER'] as Role[],active:true},sessionRoles:['WORKER'] as Role[],project:{id:'j',number:'205',currency:'BYN',deletedAt:null as Date|null},product:{id:'p',projectId:'j',quantity:3,status:'PRODUCTION',deletedAt:null as Date|null},price:{id:'tariff',name:'Cut',unit:'м.п.',price:'12.34',active:true},works:[] as Record<string,unknown>[],logs:[] as Record<string,unknown>[],failAudit:false,atTx:null as null|(()=>void)};}
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
const db={$queryRaw:async()=>[],user:{findUnique:async()=>({...state.actor})},project:{findUnique:async({where}:{where:Record<string,unknown>})=>matches(state.project,where)?{...state.project}:null},product:{findFirst:async({where}:{where:Record<string,unknown>})=>matches({...state.product,tasks:[],project:{...state.project,tasks:[]}},where)?{...state.product}:null},priceItem:{findUnique:async()=>({...state.price}),findMany:async()=>state.price.active?[{...state.price}]:[]},orgSetting:{findUnique:async()=>({value:'BYN'})},work:{findMany:async({where}:{where:Record<string,unknown>})=>state.works.filter(row=>matches({...row,project:state.project,product:{...state.product,project:state.project},tasks:[]},where)),create:async({data}:{data:Record<string,unknown>})=>{const row={id:'work',paymentKind:'LEGACY',stagePayPoolId:null,poolWeightUnits:null,...data};state.works.push(row);return row;}},changeLog:{create:async({data}:{data:Record<string,unknown>})=>{if(state.failAudit)throw Error('AUDIT_FAIL');state.logs.push(data);return data;}},$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{state.atTx?.();const before=structuredClone({...state,atTx:null});inTx=true;try{return await fn(db);}catch(error){state={...before,atTx:state.atTx};throw error;}finally{inTx=false;}}};
before(()=>{(globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;inject('../src/auth',{auth:async()=>({user:{id:'a',name:'Actor',roles:state.sessionRoles}})});inject('next/cache',{revalidatePath(){}});inject('../src/server/products/revalidate',{revalidateProductPaths:async()=>{}});inject('../src/server/plugins/changelog',{writeChangeLog:async(data:Record<string,unknown>)=>{if(state.failAudit)throw Error('AUDIT_FAIL');state.logs.push(data);}});actions=require('../src/server/works/actions');listWorkPriceOptions=require('../src/server/works/queries').listWorkPriceOptions;});
beforeEach(()=>{state=initial();});
async function add(value:unknown=input){try{return await actions.addWork(value as never);}catch(error){return{ok:false,error:error instanceof Error?error.message:'error'};}}
test('real addWork permits production WORKER with exact server price/unit/norm and atomic audit',async()=>{assert.equal((await add()).ok,true);assert.equal(state.works[0].quantity,'0.75');assert.equal(state.works[0].quantityPerUnit,'0.25');assert.equal(state.works[0].priceSnapshot,'12.34');assert.equal(state.works[0].unitSnapshot,'м.п.');assert.equal(state.works[0].total,'9.26');assert.equal(state.logs.length,1);assert.equal(inTx,false);});
test('real core rejects current status/deleted parent/inactive actor or revoked roles without writes',async()=>{for(const mutate of [()=>{state.product.status='INSTALLATION';},()=>{state.project.deletedAt=new Date();},()=>{state.product.deletedAt=new Date();},()=>{state.actor.active=false;},()=>{state.actor.roles=['ENGINEER'];}]){state=initial();state.sessionRoles=['MANAGER'];state.atTx=mutate;assert.equal((await add()).ok,false);assert.deepEqual(state.works,[]);assert.deepEqual(state.logs,[]);}});
test('server rechecks active price in transaction and takes changed tariff rather than form/preflight snapshot',async()=>{state.sessionRoles=['MANAGER'];state.actor.roles=['MANAGER'];state.atTx=()=>{state.price.price='20.00';state.price.unit='шт.';};assert.equal((await add()).ok,true);assert.equal(state.works[0].priceSnapshot,'20.00');assert.equal(state.works[0].unitSnapshot,'шт.');assert.equal(state.works[0].total,'15.00');state=initial();state.sessionRoles=['MANAGER'];state.actor.roles=['MANAGER'];state.atTx=()=>{state.price.active=false;};assert.equal((await add()).ok,false);assert.deepEqual(state.works,[]);});
test('price/unit/kind spoof and malformed decimal quantity refuse; manager union preserves other stages',async()=>{state.sessionRoles=['MANAGER'];state.actor.roles=['MANAGER'];for(const extra of [{priceSnapshot:'1'},{unit:'fake'},{total:'1'},{paymentKind:'ENGINEERING'},{quantityPerUnit:.001}]){assert.equal((await add({...input,...extra})).ok,false);assert.deepEqual(state.works,[]);}state.product.status='DESIGN';assert.equal((await add()).ok,true);});
test('audit failure rolls back real Work creation, and price/unit edits never rewrite existing work snapshots',async()=>{state.sessionRoles=['MANAGER'];state.actor.roles=['MANAGER'];state.failAudit=true;assert.equal((await add()).ok,false);assert.deepEqual(state.works,[]);state.failAudit=false;assert.equal((await add()).ok,true);const old=structuredClone(state.works[0]);state.price.price='99';state.price.unit='л';assert.deepEqual(state.works[0],old);});

import {workVisibilityWhere,taskExecutionWhere} from '../src/server/access/visibility';
import {maskProductionWorkRead} from '../src/server/access/production-read-projection';
import {canAddProductWork} from '../src/server/works/access';
test('ordinary production Work becomes readable without Task but new global DTO hides money and never enables execution',async()=>{
 assert.equal((await add()).ok,true);const actor={id:'a',roles:['WORKER'] as Role[]};const row={...state.works[0],id:String(state.works[0].id),priceSnapshot:state.works[0].priceSnapshot as string|null,total:state.works[0].total as string|null,unitSnapshot:state.works[0].unitSnapshot as string|null,project:state.project,product:{...state.product,project:state.project},tasks:[]};assert.equal(matches(row,workVisibilityWhere(actor)),true);
 assert.equal(matches({...row,paymentKind:'ENGINEERING',stagePayPoolId:'pool'},workVisibilityWhere(actor)),false);assert.equal(matches({...row,paymentKind:'INSTALLATION'},workVisibilityWhere(actor)),false);
 const masked=await maskProductionWorkRead(db as never,actor,[row]);assert.equal(masked[0].priceSnapshot,null);assert.equal(masked[0].total,null);assert.equal(masked[0].unitSnapshot,'м.п.');assert.equal(matches({...row,assigneeId:'foreign'},taskExecutionWhere(actor)),false);
 state.product.status='STORAGE';assert.equal(matches({...row,product:{...state.product,project:state.project}},workVisibilityWhere(actor)),true);
});
test('real addWork permits field MOUNTER in INSTALLATION with the same server snapshot guarantees',async()=>{state.actor.roles=['MOUNTER'];state.sessionRoles=['MOUNTER'];state.product.status='INSTALLATION';assert.equal((await add()).ok,true);assert.equal(state.works[0].quantity,'0.75');assert.equal(state.works[0].quantityPerUnit,'0.25');assert.equal(state.works[0].priceSnapshot,'12.34');assert.equal(state.works[0].unitSnapshot,'м.п.');assert.equal(state.works[0].total,'9.26');assert.equal(state.logs.length,1);assert.equal(inTx,false);});
test('scoped active tariff picker and grants follow current role/status matrix',async()=>{
 assert.equal((await listWorkPriceOptions({id:'a',roles:['WORKER']},'p')).length,1);
 state.actor.roles=['MOUNTER'];assert.equal((await listWorkPriceOptions({id:'a',roles:['MOUNTER']},'p')).length,0);
 state.product.status='INSTALLATION';assert.equal((await listWorkPriceOptions({id:'a',roles:['MOUNTER']},'p')).length,1);
 state.actor.roles=['WORKER'];assert.equal((await listWorkPriceOptions({id:'a',roles:['WORKER']},'p')).length,0);
 state.product.status='STORAGE';assert.equal((await listWorkPriceOptions({id:'a',roles:['WORKER']},'p')).length,1);
 state.product.status='DESIGN';assert.equal((await listWorkPriceOptions({id:'a',roles:['WORKER']},'p')).length,0);
 state.actor.roles=['WORKER','MANAGER'];assert.equal((await listWorkPriceOptions({id:'a',roles:['WORKER','MANAGER']},'p')).length,1);
 for(const role of ['ENGINEER','ACCOUNTANT','PROCUREMENT'] as Role[])assert.equal(canAddProductWork([role],'PRODUCTION'),false);
 assert.equal(canAddProductWork(['WORKER'],'PRODUCTION'),true);assert.equal(canAddProductWork(['WORKER'],'STORAGE'),true);
 assert.equal(canAddProductWork(['MOUNTER'],'PRODUCTION'),false);assert.equal(canAddProductWork(['MOUNTER'],'INSTALLATION'),true);
 assert.equal(canAddProductWork(['WORKER'],'DESIGN'),false);assert.equal(canAddProductWork(['MOUNTER'],'DESIGN'),false);assert.equal(canAddProductWork(['WORKER','MANAGER'],'DESIGN'),true);
});
test('known DRAFT IDs do not permit manager or role-union Work creation and produce no writes',async()=>{
 for(const roles of [['MANAGER'],['MANAGER','WORKER']] as Role[][]){
  state=initial();state.sessionRoles=roles;state.actor.roles=roles;state.product.status='DRAFT';
  assert.equal((await add()).ok,false);assert.deepEqual(state.works,[]);assert.deepEqual(state.logs,[]);
  assert.deepEqual(await listWorkPriceOptions({id:'a',roles},'p'),[]);assert.equal(canAddProductWork(roles,'DRAFT'),false);
 }
});
