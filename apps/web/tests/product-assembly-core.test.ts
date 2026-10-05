import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Prisma, ProductStatus } from '@prisma/client';
import { captureProductPercentageCompletion } from '../src/server/product-percentage-pay/core';
import { patchProductPercentageCore } from '../src/server/product-percentage-pay/patch-core';
import { changeProductStatusTransaction } from '../src/server/products/status-core';
const manager={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function fixture(rate:string|null='5',price:string|null='1000'){
 const completions:Record<string,unknown>[]=[];const payroll:Record<string,unknown>[]=[];const logs:Record<string,unknown>[]=[];
 const assembler={id:'worker',name:'Worker',active:true,roles:['WORKER']};const product={id:'p',projectId:'project',number:'1.1',title:'P',quantity:3,expectedPrice:price,status:'PRODUCTION' as ProductStatus,noModel:true,files:[],engineerId:null,mounterId:null,assemblerId:'worker',engineer:null,mounter:null,assembler,project:{currency:'BYN'},percentageConfigs:[{id:'cfg',kind:'ASSEMBLY',ratePercent:rate,revision:2,workReview:null as unknown,participants:[]}],stagePayPools:[]};
 const oldPaid:{workId:string|null;taskId:string|null}[]=[];const works:{id:string;title:string;tasks:{id:string;projectId:string;productId:string}[]}[]=[];
 const tx={product:{findUnique:async({include}:{include?:{percentageConfigs?:{where?:{kind?:string}}}}={})=>({...product,percentageConfigs:include?.percentageConfigs?.where?.kind?product.percentageConfigs.filter(row=>row.kind===include.percentageConfigs!.where!.kind):product.percentageConfigs}),update:async({data}:{data:Record<string,unknown>})=>{Object.assign(product,data);return product}},
 productPercentageConfig:{findMany:async()=>[],findUnique:async()=>product.percentageConfigs[0],update:async({data}:{data:Record<string,unknown>})=>{Object.assign(product.percentageConfigs[0],data,{revision:3});return{id:'cfg',revision:3}}},
 productPercentageCompletion:{findUnique:async({where}:{where:{productId_kind:{kind:string}}})=>completions.find(row=>row.kind===where.productId_kind.kind)??null,create:async({data}:{data:Record<string,unknown>})=>{const row={id:'completion'+completions.length,...data};completions.push(row);return row}},
 productPercentageCompletionShare:{create:async({data}:{data:Record<string,unknown>})=>({id:'share',...data})},payrollEntry:{findMany:async()=>oldPaid,create:async({data}:{data:Record<string,unknown>})=>{payroll.push(data);return{id:'payroll'}}},
 changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return{id:'log'}}},domainEvent:{create:async()=>({id:'event'})},user:{findUnique:async()=>assembler},work:{findMany:async()=>works},task:{findFirst:async()=>null},productStatusHistory:{findFirst:async()=>null,create:async()=>({id:'history'})}} as unknown as Prisma.TransactionClient;
 return{tx,product,assembler,completions,payroll,logs,oldPaid,works};
}
test('ASSEMBLY v3core captures1000×3×5%=150 tosingleWORKER atDELIVERY',async()=>{
 const f=fixture();const result=await changeProductStatusTransaction(f.tx,manager,'p','DELIVERY');assert.ok(result.ok);const snapshot=f.completions.find(row=>row.kind==='ASSEMBLY')!;assert.equal(snapshot.calculationVersion,4);assert.equal(snapshot.recipientId,'worker');assert.equal(snapshot.quantitySnapshot,3);assert.equal(String(snapshot.amount),'150.00');assert.equal(f.payroll.length,1);assert.equal(f.payroll[0].scheme,'PRODUCT_PERCENT_ASSEMBLY');
 assert.equal((await changeProductStatusTransaction(f.tx,manager,'p','DONE')).ok,true);assert.equal(f.payroll.length,1);f.product.quantity=99;assert.equal(await captureProductPercentageCompletion(f.tx,manager,'p','ASSEMBLY','DONE'),'SETTLED');assert.equal(snapshot.quantitySnapshot,3);
});
test('assemblynullskip forever/zero noPayroll/missingpositivebasis andwrongrecipient reject',async()=>{
 const skip=fixture(null);assert.equal(await captureProductPercentageCompletion(skip.tx,manager,'p','ASSEMBLY','DELIVERY'),'SKIPPED_ONCE');skip.product.percentageConfigs[0].ratePercent='10';assert.equal(await captureProductPercentageCompletion(skip.tx,manager,'p','ASSEMBLY','DONE'),'SKIPPED_ONCE');assert.equal(skip.payroll.length,0);
 for(const [rate,price] of [['0',null],['5','0']] as const){const f=fixture(rate,price);assert.equal(await captureProductPercentageCompletion(f.tx,manager,'p','ASSEMBLY','DELIVERY'),'SETTLED');assert.equal(f.payroll.length,0);}
 for(const f of [fixture('5',null),fixture()]){if(f.product.expectedPrice!==null)f.assembler.roles=['MOUNTER'];await assert.rejects(captureProductPercentageCompletion(f.tx,manager,'p','ASSEMBLY','DELIVERY'));assert.equal(f.completions.length,0);}
});
test('worker status denied; manager assemblyassignment CAS requiresactiveWORKER andpreservesfrozenrecipient',async()=>{
 const f=fixture();assert.equal((await changeProductStatusTransaction(f.tx,{...manager,id:'worker',roles:['WORKER']},'p','DELIVERY')).ok,false);
 const request={productId:'p',kind:'ASSEMBLY' as const,field:'assigneeId' as const,value:'nextworker',expectedValue:'worker',expectedRevision:2,clientMutationId:randomUUID()};
 f.assembler.roles=['MOUNTER'];assert.equal((await patchProductPercentageCore(manager,request,f.tx)).ok,false);f.assembler.roles=['WORKER'];assert.equal(await captureProductPercentageCompletion(f.tx,manager,'p','ASSEMBLY','DELIVERY'),'SETTLED');assert.equal((await patchProductPercentageCore(manager,request,f.tx)).ok,true);assert.equal(f.product.assemblerId,'nextworker');assert.equal(f.completions[0].recipientId,'worker');assert.equal(f.payroll[0].userId,'worker');
});
test('assembly ignores paid legacy work and retired classification',async()=>{
 for(const classification of [null,'COVERED','INDEPENDENT'] as const){const f=fixture();f.works.push({id:'w',title:'arbitrarylabel',tasks:[{id:'t',projectId:'project',productId:'p'}]});f.oldPaid.push({workId:null,taskId:'t'});f.product.percentageConfigs[0].workReview=classification?[{workId:'w',classification}]:null;
 assert.equal(await captureProductPercentageCompletion(f.tx,manager,'p','ASSEMBLY','DELIVERY'),'SETTLED');assert.equal(f.payroll.length,1);}
});

test('managerjumpDONE closes3stages once insharedcore; laterreturns andreclamationdo notpayagain',async()=>{
 const f=fixture();f.product.status='DESIGN';Object.assign(f.product,{engineerId:'engineer',engineer:{id:'engineer',name:'Engineer',active:true,roles:['ENGINEER']},mounterId:'mounter',mounter:{id:'mounter',name:'Mounter',active:true,roles:['MOUNTER']}});
 f.product.percentageConfigs.push({id:'eng',kind:'ENGINEERING',ratePercent:'2',revision:1,workReview:null,participants:[]},{id:'mount',kind:'INSTALLATION',ratePercent:'4',revision:1,workReview:null,participants:[]});
 assert.equal((await changeProductStatusTransaction(f.tx,manager,'p','DONE')).ok,true);
 assert.equal(f.completions.length,3);assert.equal(f.payroll.length,3);assert.deepEqual(f.payroll.map(row=>Number(row.amount)).sort((a,b)=>a-b),[20,120,150]);
 for(const status of ['RECLAMATION','PRODUCTION','DELIVERY','DONE'] as const)assert.equal((await changeProductStatusTransaction(f.tx,manager,'p',status)).ok,true);
 assert.equal(f.completions.length,3);assert.equal(f.payroll.length,3);
});
test('invalidASSEMBLY recipient rolls back wholemanagerjump includingearlierENGINEERINGpay',async()=>{
 const f=fixture();f.product.status='DESIGN';Object.assign(f.product,{engineerId:'engineer',engineer:{id:'engineer',name:'Engineer',active:true,roles:['ENGINEER']}});f.product.percentageConfigs.push({id:'eng',kind:'ENGINEERING',ratePercent:'2',revision:1,workReview:null,participants:[]});f.assembler.active=false;
 let earlierWrites=0;const transaction=async()=>{const before=f.product.status;try{return await changeProductStatusTransaction(f.tx,manager,'p','DONE');}catch(error){earlierWrites=f.payroll.length;f.product.status=before;f.payroll.length=0;f.completions.length=0;f.logs.length=0;throw error;}};
 await assert.rejects(transaction(),/активного сборщика/);assert.equal(earlierWrites,1);assert.equal(f.product.status,'DESIGN');assert.deepEqual(f.payroll,[]);assert.deepEqual(f.completions,[]);
});
test('corrupt retired cross-stage reviews have no effect on independent direct accrual',async()=>{
 const f=fixture();f.works.push({id:'w',title:'sameidnotname',tasks:[]});f.product.percentageConfigs[0].workReview=[{workId:'w',classification:'COVERED'}];
 f.tx.productPercentageConfig.findMany=(async()=>{throw new Error('must not inspect retired coverage')}) as never;
 assert.equal(await captureProductPercentageCompletion(f.tx,manager,'p','ASSEMBLY','DELIVERY'),'SETTLED');assert.equal(f.payroll.length,1);
});
