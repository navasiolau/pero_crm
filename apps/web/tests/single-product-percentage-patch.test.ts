import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { patchProductPercentageCore } from '../src/server/product-percentage-pay/patch-core';
import type { ProductPercentagePatch } from '../src/server/product-percentage-pay/contracts';
const manager={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function fixture(){const product={id:'p',projectId:'project',engineerId:'e',mounterId:'m'};const cfg={id:'cfg',revision:2,ratePercent:{toString:()=> '5'},workReview:null as unknown};const logs:Record<string,unknown>[]=[];const writes:string[]=[];let completed=false;
 const tx={product:{findUnique:async()=>product,update:async({data}:{data:Record<string,unknown>})=>{writes.push('product');Object.assign(product,data)}},
 productPercentageConfig:{findMany:async()=>[],findUnique:async()=>cfg,update:async({data}:{data:Record<string,unknown>})=>{writes.push('config');Object.assign(cfg,{...data,revision:cfg.revision+1});return cfg}},
 changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(log=>log.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{writes.push('audit');logs.push(data)}},
 user:{findUnique:async({where}:{where:{id:string}})=>({active:where.id!=='inactive',roles:['MOUNTER']})},
 productPercentageCompletion:{findUnique:async()=>completed?{id:'completion'}:null},work:{findMany:async()=>[{id:'w',title:'real ordinary work',tasks:[{id:'t',productId:'p',projectId:'project'}]}]},payrollEntry:{findMany:async()=>[{workId:null,taskId:'t'}]},task:{findFirst:async()=>({id:'unfinished-old-allocation'})}} as unknown as Prisma.TransactionClient;
 return{tx,product,cfg,logs,writes,complete:()=>{completed=true}};}
const input=(patch:Partial<ProductPercentagePatch>={}):ProductPercentagePatch=>({productId:'p',kind:'INSTALLATION',field:'ratePercent',value:'6',expectedValue:'5',expectedRevision:2,clientMutationId:randomUUID(),...patch} as ProductPercentagePatch);
test('single rate CAS replay exactUUID and rejects changedIDpayload without writing historicalparticipants',async()=>{
 const f=fixture(),request=input();const first=await patchProductPercentageCore(manager,request,f.tx);assert.ok(first.ok);assert.equal(first.revision,3);const before=f.writes.length;
 const again=await patchProductPercentageCore(manager,request,f.tx);assert.ok(again.ok);assert.equal(again.repeated,true);assert.equal(f.writes.length,before);
 assert.equal((await patchProductPercentageCore(manager,{...request,value:'7'} as ProductPercentagePatch,f.tx)).ok,false);assert.equal(f.writes.length,before);
});
test('current fields can change after completion while stale peers conflict and wrongroles/inactive recipients fail',async()=>{
 const f=fixture();f.complete();assert.equal((await patchProductPercentageCore(manager,input(),f.tx)).ok,true);
 const stale=await patchProductPercentageCore(manager,input({field:'assigneeId',value:'m2',expectedValue:'m'}),f.tx);assert.equal(stale.kind,'conflict');assert.equal(f.product.mounterId,'m');
 assert.equal((await patchProductPercentageCore(manager,input({field:'assigneeId',value:'inactive',expectedValue:'m',expectedRevision:3}),f.tx)).ok,false);
 const before=f.writes.length;assert.equal((await patchProductPercentageCore({...manager,roles:['ENGINEER']},input(),f.tx)).kind,'forbidden');assert.equal(f.writes.length,before);
});
test('retired workReview rejects without any writes and ordinary same value remains no-op',async()=>{
 const f=fixture();const patch={...input(),field:'workReview',value:[{workId:'w',classification:'INDEPENDENT'}],expectedValue:[]} as unknown as ProductPercentagePatch;
 const result=await patchProductPercentageCore(manager,patch,f.tx);assert.equal(result.kind,'validation');assert.deepEqual(f.writes,[]);
 const g=fixture();const same=await patchProductPercentageCore(manager,input({value:'5'}),g.tx);assert.ok(same.ok);assert.equal(same.noOp,true);assert.deepEqual(g.writes,[]);
});

test('all three kinds refuse a forged rate above15 before config or audit writes',async()=>{
 for(const kind of ['ENGINEERING','ASSEMBLY','INSTALLATION'] as const){const f=fixture();const result=await patchProductPercentageCore(manager,input({kind,value:'15.01'}),f.tx);assert.equal(result.kind,'validation');if(!result.ok)assert.match(result.error,/15/);assert.deepEqual(f.writes,[]);}
});

test('DRAFT guard rejects current percentage field previews before conflict/replay and preserves all values',async()=>{
 const f=fixture();Object.assign(f.product,{status:'DRAFT'});
 const before=structuredClone({product:f.product,writes:f.writes,logs:f.logs});
 const result=await patchProductPercentageCore(manager,input({expectedRevision:1}),f.tx);
 assert.equal(result.kind,'not-found');assert.deepEqual({product:f.product,writes:f.writes,logs:f.logs},before);
 assert.equal('currentValue' in result,false);assert.equal('currentRevision' in result,false);
});
