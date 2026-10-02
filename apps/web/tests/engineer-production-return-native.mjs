// Root-only real SQL regression. Every fixture and frozen fact lives in one outer rollback.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {guard,fingerprint} from './product-attachments-native.mjs';
import {changeProductStatusTransaction} from '../src/server/products/status-core.ts';
import {productVisibilityWhere,productEditWhere} from '../src/server/access/visibility.ts';
import {decideProductPercentageStatus} from '../src/lib/product-percentage-status.ts';
let phase='guard';
async function main(){
 const target=guard(),db=new PrismaClient(),checks=[],rollback=Error('EXPECTED_ENGINEER_RETURN_OUTER_ROLLBACK');
 const originalFetch=globalThis.fetch;let externalFetchCalls=0;globalThis.fetch=async()=>{externalFetchCalls++;throw Error('NATIVE_EXTERNAL_FETCH_FORBIDDEN');};
 try{
  const before=await fingerprint(db);assert.ok(Object.keys(before).length>=41,'ALL_TABLE_BASELINE_REQUIRED');
  await assert.rejects(db.$transaction(async tx=>{
   globalThis.__crmPercentageTx=tx;
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
   const [identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name,current_schema() AS schema');assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
   const marker=randomUUID(),user=roles=>tx.user.create({data:{id:randomUUID(),name:'QA return '+marker,email:randomUUID()+'@invalid.test',passwordHash:'QA_DISABLED_NOT_A_PASSWORD_HASH',roles,active:true}});
   const engineer=await user(['ENGINEER']),foreign=await user(['ENGINEER']),manager=await user(['MANAGER']);
   const actor={id:engineer.id,name:engineer.name,roles:engineer.roles,source:'api'},management={id:manager.id,name:manager.name,roles:manager.roles,source:'api'};
   const client=await tx.client.create({data:{id:randomUUID(),name:'QA return '+marker,phone:'100'}}),max=await tx.project.aggregate({_max:{numberInt:true}}),numberInt=(max._max.numberInt??0)+1;
   const project=await tx.project.create({data:{id:randomUUID(),number:String(numberInt),numberInt,title:'QA return '+marker,clientId:client.id,currency:'BYN'}});
   let suffix=0;const product=()=>tx.product.create({data:{id:randomUUID(),projectId:project.id,number:project.number+'.'+(++suffix),suffixInt:suffix,title:'QA return',quantity:3,expectedPrice:'1000',engineerId:engineer.id,status:'DESIGN',noModel:false}});
   const paid=await product();await tx.productPercentageConfig.create({data:{productId:paid.id,kind:'ENGINEERING',ratePercent:'5',revision:1}});
   const move=(p,status,who=actor)=>changeProductStatusTransaction(tx,who,p.id,status);
   phase='assigned_forward_150';assert.equal(await tx.file.count({where:{productId:paid.id}}),0);assert.equal(await tx.task.count({where:{productId:paid.id}}),0);
   assert.equal((await move(paid,'PRODUCTION')).ok,true);
   const frozen=await tx.productPercentageCompletion.findUnique({where:{productId_kind:{productId:paid.id,kind:'ENGINEERING'}},include:{shares:{include:{payrollEntry:true}}}});
   assert.equal(frozen.state,'SETTLED');assert.equal(frozen.calculationVersion,2);assert.equal(frozen.quantitySnapshot,3);assert.equal(frozen.amount.toFixed(2),'150.00');assert.equal(await tx.payrollEntry.count({where:{productId:paid.id}}),1);checks.push('assigned_ENGINEER_zeroFile_noModelFalse_PRODUCTION_150_single_payroll');
   phase='assigned_read_no_technical_write';assert.ok(await tx.product.findFirst({where:{AND:[{id:paid.id},productVisibilityWhere(actor)]}}));assert.equal(await tx.product.findFirst({where:{AND:[{id:paid.id},productEditWhere(actor)]}}),null);checks.push('assigned_PRODUCTION_read_withoutTask_technical_edit_denied');
   phase='return_and_repeat';assert.equal((await move(paid,'DESIGN')).ok,true);assert.equal((await move(paid,'PRODUCTION')).ok,true);assert.equal((await move(paid,'PRODUCTION')).ok,true);
   assert.deepEqual(await tx.productPercentageCompletion.findUnique({where:{id:frozen.id},include:{shares:{include:{payrollEntry:true}}}}),frozen);assert.equal(await tx.payrollEntry.count({where:{productId:paid.id}}),1);checks.push('PRODUCTION_DESIGN_return_repeat_immutable_150_no_duplicate_payroll');
   phase='current_assignment_not_legacy_recipient';await tx.product.update({where:{id:paid.id},data:{engineerId:foreign.id}});
   const denialBefore=await fingerprint(tx);for(const status of ['DESIGN','DELIVERY','INSTALLATION','DONE','RECLAMATION'])assert.equal((await move(paid,status)).ok,false);
   assert.deepEqual(await fingerprint(tx),denialBefore);assert.equal(await tx.product.findFirst({where:{AND:[{id:paid.id},productVisibilityWhere(actor)]}}),null);
   assert.equal((await move(paid,'DESIGN',{...actor,id:foreign.id})).ok,true);for(const status of ['DELIVERY','INSTALLATION','DONE','RECLAMATION'])assert.equal((await move(paid,status,{...actor,id:foreign.id})).ok,false);checks.push('legacy_paid_recipient_and_unassigned_refused_current_assignee_only_two_statuses');
   phase='management_late_status_no_model';const late=await product();await tx.productPercentageConfig.create({data:{productId:late.id,kind:'ENGINEERING',ratePercent:'0',revision:1}});
   for(const status of ['DESIGN','PRODUCTION','DELIVERY','INSTALLATION','DONE','RECLAMATION'])assert.equal(decideProductPercentageStatus(['MANAGER','ENGINEER'],{from:'DESIGN',to:status,assignedEngineer:false,participant:false,hasB3d:false,noModel:false}).allowed,true);
   assert.equal((await move(late,'DONE',management)).ok,true);const completed=await tx.productPercentageCompletion.findMany({where:{productId:late.id},orderBy:{kind:'asc'}});assert.equal(completed.length,3);assert.equal(completed.find(row=>row.kind==='ENGINEERING').amount.toFixed(2),'0.00');assert.ok(completed.filter(row=>row.kind!=='ENGINEERING').every(row=>row.state==='SKIPPED_ONCE'));assert.equal(await tx.payrollEntry.count({where:{productId:late.id}}),0);checks.push('manager_anyStatus_policy_actual_direct_DONE_zero_skip_noFile_no_payroll');
   throw rollback;
  },{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000}),error=>error===rollback);
  assert.deepEqual(await fingerprint(db),before);assert.equal(externalFetchCalls,0);
  console.log(JSON.stringify({kind:'engineer-production-return-native',target,checks,externalFetchCalls,rollbackVerified:true,capturedTableCount:Object.keys(before).length,fingerprintProfile:'all-models-and-migrations-ApiToken.lastUsedAt-only-operational-v2',tables:before,scope:'real status SQL/ACL/frozen payroll in outer ROLLBACK; no hosted concurrency or browser proof'}));
 }finally{globalThis.fetch=originalFetch;delete globalThis.__crmPercentageTx;await db.$disconnect();}
}
try{await main();}catch{console.log(JSON.stringify({kind:'engineer-production-return-native',status:'FAIL',phase}));process.exitCode=1;}
