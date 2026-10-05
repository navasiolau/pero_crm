import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { changeProductStatusTransaction } from '../src/server/products/status-core';
import { captureProductPercentageCompletion } from '../src/server/product-percentage-pay/core';
const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function fixture(rate:string|null='5',price:string|null='1000',recipient=true){
 const history:unknown[]=[];let failAudit=false;
 const completions:Record<string,unknown>[]=[];const payroll:Record<string,unknown>[]=[];const logs:Record<string,unknown>[]=[];
 const product={status:'DESIGN' as import('@prisma/client').ProductStatus,noModel:true,files:[],title:'P',id:'p',number:'1.1',projectId:'project',quantity:3,expectedPrice:price,engineerId:recipient?'engineer':null,mounterId:recipient?'mounter':null,
 engineer:recipient?{id:'engineer',name:'Engineer',active:true,roles:['ENGINEER']}:null,mounter:recipient?{id:'mounter',name:'Mounter',active:true,roles:['MOUNTER']}:null,
 project:{currency:'BYN'},percentageConfigs:[{id:'cfg',kind:'ENGINEERING',ratePercent:rate,revision:2,workReview:null as unknown,participants:[]},{id:'installcfg',kind:'INSTALLATION',ratePercent:rate,revision:2,workReview:null as unknown,participants:[]}],stagePayPools:[]};
 const tx={productPercentageConfig:{findMany:async()=>[]},product:{findUnique:async({include}:{include?:{percentageConfigs?:{where?:{kind?:string}}}}={})=>({...product,percentageConfigs:include?.percentageConfigs?.where?.kind?product.percentageConfigs.filter(row=>row.kind===include.percentageConfigs!.where!.kind):product.percentageConfigs}),update:async({data}:{data:{status:import('@prisma/client').ProductStatus}})=>{product.status=data.status;return product}},productPercentageCompletion:{findUnique:async({where}:{where:{productId_kind:{kind:string}}})=>completions.find(row=>row.kind===where.productId_kind.kind)??null,create:async({data}:{data:Record<string,unknown>})=>{const row={id:'completion',...data};completions.push(row);return row}},
 productPercentageCompletionShare:{create:async({data}:{data:Record<string,unknown>})=>({id:'share',...data})},user:{findUnique:async({where}:{where:{id:string}})=>where.id==='engineer'?product.engineer:product.mounter},
 payrollEntry:{create:async({data}:{data:Record<string,unknown>})=>{payroll.push(data);return{id:'payroll'}}},domainEvent:{create:async()=>({id:'event'})},changeLog:{create:async({data}:{data:Record<string,unknown>})=>{if(failAudit)throw new Error('audit unavailable');logs.push(data);return{id:'log'}}},work:{findMany:async()=>[]},task:{findFirst:async()=>null},productStatusHistory:{findFirst:async()=>history.length?history[0]:null,create:async({data}:{data:unknown})=>{history.push(data);return{id:'history'}}}} as unknown as Prisma.TransactionClient;
 return{tx,product,completions,payroll,logs,history,failAudit:()=>{failAudit=true}};
}
test('v3 engineer completion uses unit1000×rate5=50BYN and preserves batch snapshots',async()=>{
 const f=fixture();assert.equal(await captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'),'SETTLED');
 assert.equal(f.completions[0].calculationVersion,3);assert.equal(String(f.completions[0].priceSnapshot),'1000');assert.equal(f.completions[0].quantitySnapshot,3);
 assert.equal(String(f.completions[0].totalSnapshot),'3000');assert.equal(String(f.completions[0].amount),'50.00');assert.equal(f.completions[0].recipientId,'engineer');
 assert.equal(f.payroll.length,1);assert.equal(String(f.payroll[0].bynAmount),'50.00');
 f.product.quantity=9;assert.equal(await captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'),'SETTLED');assert.equal(f.payroll.length,1);assert.equal(f.completions[0].quantitySnapshot,3);
});
test('nullrate is once-skipped, never backpaid by later current settings',async()=>{
 const f=fixture(null);assert.equal(await captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'),'SKIPPED_ONCE');
 f.product.percentageConfigs[0].ratePercent='5';assert.equal(await captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'),'SKIPPED_ONCE');assert.equal(f.payroll.length,0);
});
test('zero rate or price produces settled zero withoutPayroll, missingpositivebasis refuses beforewrites',async()=>{
 for(const [rate,price] of [['0',null],['5','0']] as const){const f=fixture(rate,price);assert.equal(await captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'),'SETTLED');assert.equal(String(f.completions[0].amount),'0.00');assert.equal(f.payroll.length,0);}
 for(const f of [fixture('5',null),fixture('5','1000',false)]){await assert.rejects(captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'));assert.equal(f.completions.length,0);assert.equal(f.payroll.length,0);}
});

test('directmanagerDONE closesboth thresholds once, return/reclamation neverpayagain',async()=>{
 const f=fixture();const result=await changeProductStatusTransaction(f.tx,actor,'p','DONE');assert.ok(result.ok);assert.equal(f.completions.length,3);assert.equal(f.payroll.length,2);
 for(const status of ['RECLAMATION','DESIGN','PRODUCTION','DONE'] as const)assert.equal((await changeProductStatusTransaction(f.tx,actor,'p',status)).ok,true);
 assert.equal(f.completions.length,3);assert.equal(f.payroll.length,2);
});
test('status/completion/payroll are inside suppliedtransaction and rollback together on auditfailure',async()=>{
 const f=fixture();f.failAudit();
 // Repository transaction adapter rolls back the exact recorded write set.
 const transaction=async()=>{const before={status:f.product.status,c:f.completions.length,p:f.payroll.length,l:f.logs.length,h:f.history.length};try{return await changeProductStatusTransaction(f.tx,actor,'p','PRODUCTION');}catch(error){f.product.status=before.status;f.completions.length=before.c;f.payroll.length=before.p;f.logs.length=before.l;f.history.length=before.h;throw error;}};
 await assert.rejects(transaction(),/audit unavailable/);assert.equal(f.product.status,'DESIGN');assert.deepEqual(f.completions,[]);assert.deepEqual(f.payroll,[]);assert.deepEqual(f.history,[]);
});
test('positive rate rejects inactive/wrongrecipient; realstatuspolicy protects unassignedEngineer',async()=>{
 for(const invalid of ['inactive','role']){const f=fixture();if(invalid==='inactive')f.product.engineer!.active=false;else f.product.engineer!.roles=['WORKER'];await assert.rejects(captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'));assert.equal(f.payroll.length,0);}
 const f=fixture();assert.equal((await changeProductStatusTransaction(f.tx,{...actor,id:'other',roles:['ENGINEER']},'p','PRODUCTION')).ok,false);assert.equal(f.product.status,'DESIGN');
});

test('ordinary works, unfinished tasks and former covered paid history never gate direct pay',async()=>{
 for(const classification of [null,'COVERED','INDEPENDENT'] as const){
 const f=fixture();f.product.percentageConfigs[0].kind='INSTALLATION';
 f.product.percentageConfigs[0].workReview=classification?[{workId:'w',classification}]:null;
 f.tx.work.findMany=(async()=>{throw new Error('must not read works')}) as never;
 f.tx.payrollEntry.findMany=(async()=>{throw new Error('must not read prior ordinary pay')}) as never;
 assert.equal(await captureProductPercentageCompletion(f.tx,actor,'p','INSTALLATION','DONE'),'SETTLED');
 assert.equal(String(f.completions[0].amount),'150.00');assert.equal(f.payroll.length,1);
 }
});
test('historical original status prevents engineering backpay but allows future assembly completion',async()=>{
 const f=fixture();f.product.status='PRODUCTION';const first=await changeProductStatusTransaction(f.tx,actor,'p','DELIVERY');assert.ok(first.ok);assert.equal(f.completions.length,1);assert.equal(f.completions[0].kind,'ASSEMBLY');assert.equal(f.payroll.length,0);
 const g=fixture();g.completions.push({id:'legacy',kind:'ENGINEERING',state:'LEGACY_PROTECTED',calculationVersion:1,priceSnapshot:null});const original=structuredClone(g.completions[0]);
 assert.equal((await changeProductStatusTransaction(g.tx,actor,'p','PRODUCTION')).ok,true);assert.deepEqual(g.completions[0],original);assert.equal(g.payroll.length,0);
});
test('prior history protects returned historical stages without recording money or invented markers',async()=>{
 const f=fixture();f.history.push({toStatus:'DONE'});
 assert.equal((await changeProductStatusTransaction(f.tx,actor,'p','DONE')).ok,true);
 assert.equal(f.completions.length,0);assert.equal(f.payroll.length,0);
});

test('full cycle without Work or Task produces 50/120/210 once with v3 actual quantity snapshots',async()=>{
 const f=fixture();Object.assign(f.product,{assemblerId:'assembler',assembler:{id:'assembler',name:'Assembler',active:true,roles:['WORKER']}});
 f.product.percentageConfigs[1].ratePercent='7';f.product.percentageConfigs.push({id:'assembly',kind:'ASSEMBLY',ratePercent:'4',revision:1,workReview:null,participants:[]});
 f.tx.work.findMany=(async()=>{throw new Error('no work read')}) as never;f.tx.task.findFirst=(async()=>{throw new Error('no task read')}) as never;
 // History reader models the real query: prior earlier stages do not protect later stages.
 f.tx.productStatusHistory.findFirst=(async({where}:{where:{OR:{fromStatus?:{in:string[]};toStatus?:{in:string[]}}[]}})=>f.history.find((row)=>{
   const h=row as {fromStatus:string;toStatus:string};return where.OR.some(filter=>filter.fromStatus?.in.includes(h.fromStatus)||filter.toStatus?.in.includes(h.toStatus));
 })??null) as never;
 for(const status of ['PRODUCTION','DELIVERY','INSTALLATION','DONE'] as const)assert.equal((await changeProductStatusTransaction(f.tx,actor,'p',status)).ok,true);
 assert.deepEqual(f.payroll.map(row=>Number(row.amount)),[50,120,210]);
 assert.ok(f.completions.every(row=>row.calculationVersion===3&&row.quantitySnapshot===3&&String(row.totalSnapshot)==='3000'));
 for(const status of ['DESIGN','DONE'] as const)assert.equal((await changeProductStatusTransaction(f.tx,actor,'p',status)).ok,true);
 assert.equal(f.payroll.length,3);
});

test('new completion with a saved rate above15 fails before monetary writes',async()=>{
 const f=fixture('15.01','1000');await assert.rejects(captureProductPercentageCompletion(f.tx,actor,'p','ENGINEERING','PRODUCTION'),/15/);assert.equal(f.completions.length,0);assert.equal(f.payroll.length,0);
});
