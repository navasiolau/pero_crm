// Root-only execution. Real SQL/core proof inside one outer rollback, not hosted concurrency proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {guard,fingerprint} from './product-attachments-native.mjs';
import {createTaskTransaction} from '../src/server/tasks/transaction.ts';
import {changeProductStatusTransaction} from '../src/server/products/status-core.ts';
import {configureProductPercentageCore,transferProductPercentageCore} from '../src/server/product-percentage-pay/core.ts';
import {patchProductPercentageCore} from '../src/server/product-percentage-pay/patch-core.ts';
let phase='guard';
async function main(){
 const target=guard(),db=new PrismaClient(),checks=[],rollback=Error('EXPECTED_PERCENTAGE_OUTER_ROLLBACK');
 const originalFetch=globalThis.fetch;let externalFetchCalls=0;globalThis.fetch=async()=>{externalFetchCalls++;throw Error('NATIVE_EXTERNAL_FETCH_FORBIDDEN');};
 try{
  const before=await fingerprint(db);
  await assert.rejects(db.$transaction(async tx=>{
   globalThis.__crmPercentageTx=tx;let serial=0;
   const boundary=async(fn,inject)=>{const name=`percentage_${++serial}`;await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);try{const result=await fn(inject??tx);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);throw error;}};
   globalThis.__crmPercentageTransaction=fn=>boundary(fn);
   const transaction=createTaskTransaction({$transaction:fn=>boundary(fn)});
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
   const [identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name,current_schema() AS schema');assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
   const marker=randomUUID();
   const user=async roles=>tx.user.create({data:{id:randomUUID(),name:'QA percentage '+marker,email:randomUUID()+'@invalid.test',passwordHash:'QA_DISABLED_NOT_A_PASSWORD_HASH',roles,active:true}});
   const manager=await user(['MANAGER']),engineer=await user(['ENGINEER']),mounter=await user(['MOUNTER']);
   const actor={id:manager.id,name:manager.name,roles:manager.roles,source:'api'};
   const client=await tx.client.create({data:{id:randomUUID(),name:'QA percentage '+marker,phone:'100'}});
   const max=await tx.project.aggregate({_max:{numberInt:true}}),numberInt=(max._max.numberInt??0)+1;
   const project=await tx.project.create({data:{id:randomUUID(),number:String(numberInt),numberInt,title:'QA percentage '+marker,clientId:client.id,currency:'BYN'}});
   let suffix=0;
   const product=async(data={})=>tx.product.create({data:{id:randomUUID(),projectId:project.id,number:project.number+'.'+(++suffix),suffixInt:suffix,title:'QA percentage',quantity:3,expectedPrice:'1000',engineerId:engineer.id,mounterId:mounter.id,status:'DESIGN',...data}});
   const config=async(p,kind='ENGINEERING',rate='5',workReview)=>tx.productPercentageConfig.create({data:{productId:p.id,kind,ratePercent:rate,revision:1,...(workReview?{workReview}:{})}});
   const move=(p,status)=>transaction(inner=>changeProductStatusTransaction(inner,actor,p.id,status));
   const completion=(p,kind='ENGINEERING')=>tx.productPercentageCompletion.findUnique({where:{productId_kind:{productId:p.id,kind}},include:{shares:{include:{payrollEntry:true}}}});

   phase='single_capture';const paid=await product();await config(paid);assert.equal((await move(paid,'PRODUCTION')).ok,true);
   const frozen=await completion(paid);assert.equal(frozen.calculationVersion,2);assert.equal(frozen.quantitySnapshot,3);assert.equal(frozen.priceSnapshot.toFixed(2),'1000.00');assert.equal(frozen.totalSnapshot.toFixed(2),'3000.00');assert.equal(frozen.amount.toFixed(2),'150.00');assert.equal(frozen.recipientId,engineer.id);assert.equal(frozen.shares.length,1);assert.equal(frozen.shares[0].payrollEntry.amount.toFixed(2),'150.00');
   const once=await fingerprint(tx);assert.equal((await move(paid,'PRODUCTION')).ok,true);assert.deepEqual(await fingerprint(tx),once);
   const edit=await transaction(inner=>patchProductPercentageCore(actor,{productId:paid.id,kind:'ENGINEERING',field:'ratePercent',value:'7',expectedValue:'5',expectedRevision:1,clientMutationId:randomUUID()},inner));assert.equal(edit.ok,true);
   const successor=await user(['ENGINEER']);const reassigned=await transaction(inner=>patchProductPercentageCore(actor,{productId:paid.id,kind:'ENGINEERING',field:'assigneeId',value:successor.id,expectedValue:engineer.id,expectedRevision:2,clientMutationId:randomUUID()},inner));assert.equal(reassigned.ok,true);
   await tx.product.update({where:{id:paid.id},data:{quantity:4,expectedPrice:'2000'}});assert.equal((await move(paid,'DESIGN')).ok,true);assert.equal((await move(paid,'PRODUCTION')).ok,true);assert.deepEqual(await completion(paid),frozen);assert.equal(await tx.payrollEntry.count({where:{productId:paid.id}}),1);checks.push('real_status_v2_150_one_recipient_payroll_replay_current_edits_frozen');

   phase='null_skip';const skipped=await product();assert.equal((await move(skipped,'PRODUCTION')).ok,true);assert.equal((await completion(skipped)).state,'SKIPPED_ONCE');const late=await transaction(inner=>patchProductPercentageCore(actor,{productId:skipped.id,kind:'ENGINEERING',field:'ratePercent',value:'5',expectedValue:null,expectedRevision:0,clientMutationId:randomUUID()},inner));assert.equal(late.ok,true);await move(skipped,'DESIGN');await move(skipped,'PRODUCTION');assert.equal(await tx.payrollEntry.count({where:{productId:skipped.id}}),0);checks.push('null_skip_late_rate_no_backpay');

   phase='explicit_zero';for(const shape of [{expectedPrice:null,rate:'0'},{expectedPrice:'0',rate:'5'}]){const p=await product({expectedPrice:shape.expectedPrice});await config(p,'ENGINEERING',shape.rate);assert.equal((await move(p,'PRODUCTION')).ok,true);const c=await completion(p);assert.equal(c.state,'SETTLED');assert.equal(c.amount.toFixed(2),'0.00');assert.equal(await tx.payrollEntry.count({where:{productId:p.id}}),0);}checks.push('zero_rate_missing_price_and_zero_price_no_payroll');

   phase='whole_sql_rollback';for(const shape of [{expectedPrice:null},{engineerId:null}]){const p=await product(shape);await config(p);const snapshot=await fingerprint(tx);await assert.rejects(move(p,'PRODUCTION'),/цену|инженера/);assert.deepEqual(await fingerprint(tx),snapshot);}
   const auditProduct=await product();await config(auditProduct);const auditBefore=await fingerprint(tx);const injected=new Proxy(tx,{get(target,key){if(key==='changeLog')return new Proxy(target.changeLog,{get(model,method){if(method==='create')return async()=>{throw Error('QA_PERCENTAGE_AUDIT_FAILURE')};return model[method]}});return target[key]}});
   const failing=createTaskTransaction({$transaction:fn=>boundary(fn,injected)});await assert.rejects(failing(inner=>changeProductStatusTransaction(inner,actor,auditProduct.id,'PRODUCTION')),/QA_PERCENTAGE_AUDIT_FAILURE/);assert.deepEqual(await fingerprint(tx),auditBefore);checks.push('missing_price_assignee_and_audit_failure_real_SQL_rollback');

   phase='paid_legacy_relation';for(const classification of ['COVERED','INDEPENDENT']){const p=await product({status:'INSTALLATION'});const work=await tx.work.create({data:{id:randomUUID(),projectId:project.id,productId:p.id,title:'Uninformative name '+randomUUID(),quantity:1,priceSnapshot:'50',total:'50',paymentKind:'LEGACY'}});const task=await tx.task.create({data:{id:randomUUID(),projectId:project.id,productId:p.id,workId:work.id,title:'Uninformative task',status:'DONE',assigneeId:mounter.id}});await tx.payrollEntry.create({data:{userId:mounter.id,projectId:project.id,productId:p.id,taskId:task.id,amount:'50',currency:'BYN',scheme:'PIECE',month:'2026-09'}});await config(p,'INSTALLATION','5');const preReview=await fingerprint(tx);await assert.rejects(move(p,'DONE'),/Классифицируйте/);assert.deepEqual(await fingerprint(tx),preReview);const review=await transaction(inner=>patchProductPercentageCore(actor,{productId:p.id,kind:'INSTALLATION',field:'workReview',value:[{workId:work.id,classification}],expectedValue:[],expectedRevision:1,clientMutationId:randomUUID()},inner));assert.equal(review.ok,true);assert.equal((await move(p,'DONE')).ok,true);const c=await completion(p,'INSTALLATION');assert.equal(c.state,classification==='COVERED'?'LEGACY_PROTECTED':'SETTLED');assert.equal(c.amount?.toFixed(2)??null,classification==='COVERED'?null:'150.00');assert.equal(await tx.payrollEntry.count({where:{productId:p.id}}),classification==='COVERED'?1:2);}checks.push('real_taskId_workId_paid_facts_covered_protection_independent_separate');

   phase='stale_contract';const staleBefore=await fingerprint(tx);await assert.rejects(transaction(inner=>configureProductPercentageCore(actor,{productId:paid.id,kind:'ENGINEERING',ratePercent:'5',participants:[],expectedRevision:0},inner)));await assert.rejects(transaction(inner=>transferProductPercentageCore(actor,{productId:paid.id,kind:'ENGINEERING',toUserId:mounter.id,percentOfOwnShare:'100',expectedRevision:0},inner)));const invalid=await transaction(inner=>patchProductPercentageCore(actor,{productId:paid.id,kind:'ENGINEERING',field:'ratePercent',value:'8',expectedValue:'7',expectedRevision:3,clientMutationId:randomUUID(),participants:[]},inner));assert.equal(invalid.ok,false);assert.deepEqual(await fingerprint(tx),staleBefore);checks.push('retired_config_transfer_unknown_payload_refused_no_mutation');

   phase='SQL_constraints';const constraintBefore=await fingerprint(tx);for(const data of [{quantitySnapshot:0},{productCurrency:'USD'},{recipientId:mounter.id},{priceSnapshot:'2'}])await assert.rejects(boundary(inner=>inner.productPercentageCompletion.update({where:{id:frozen.id},data})));assert.deepEqual(await fingerprint(tx),constraintBefore);
   const legacy=await product();const legacyFact=await tx.productPercentageCompletion.create({data:{productId:legacy.id,kind:'ENGINEERING',state:'LEGACY_PROTECTED',statusAtCompletion:'PRODUCTION',priceSnapshot:'123',productCurrency:'USD'}});assert.equal(legacyFact.calculationVersion,1);assert.equal(legacyFact.quantitySnapshot,null);await tx.product.update({where:{id:legacy.id},data:{quantity:9}});assert.equal((await completion(legacy)).quantitySnapshot,null);
   const invalidProduct=await product();const validShape={productId:invalidProduct.id,kind:'ENGINEERING',state:'SETTLED',statusAtCompletion:'PRODUCTION',calculationVersion:2,quantitySnapshot:3,priceSnapshot:'1000',totalSnapshot:'3000',ratePercentSnapshot:'5',recipientId:engineer.id,productCurrency:'BYN',payrollCurrency:'BYN',productRateByn:1,payrollRateByn:1,productRateDate:new Date(),payrollRateDate:new Date(),sourceFundExact:'150',amount:'150',bynAmount:'150',projectAmount:'150',settledAt:new Date()};
   for(const invalid of [{quantitySnapshot:0},{productCurrency:'USD'},{totalSnapshot:'2999'},{recipientId:null},{calculationVersion:1}])await assert.rejects(boundary(inner=>inner.productPercentageCompletion.create({data:{...validShape,...invalid}})));
   assert.equal(await tx.productPercentageCompletion.count({where:{productId:invalidProduct.id}}),0);checks.push('PostgreSQL_v2_shape_immutable_inputs_legacy_v1_qty_NULL_preserved');
   throw rollback;
  },{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000}),error=>error===rollback);
  assert.deepEqual(await fingerprint(db),before);assert.equal(externalFetchCalls,0);
  console.log(JSON.stringify({kind:'product-single-percentage-native',target,checks,externalFetchCalls,rollbackVerified:true,capturedTableCount:Object.keys(before).length,fingerprintProfile:'all-models-and-migrations-ApiToken.lastUsedAt-only-operational-v2',tables:before,scope:'actual SQL/status/core/audit in outer rollback; sequential savepoints, no hosted concurrency or delivery claim'}));
 }finally{globalThis.fetch=originalFetch;delete globalThis.__crmPercentageTx;delete globalThis.__crmPercentageTransaction;await db.$disconnect();}
}
try{await main();}catch{console.log(JSON.stringify({kind:'product-single-percentage-native',status:'FAIL',phase}));process.exitCode=1;}
