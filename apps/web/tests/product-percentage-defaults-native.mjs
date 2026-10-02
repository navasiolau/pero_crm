// Root-only real SQL/core regression: one guarded outer rollback, no hosted race claim.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {guard,fingerprint} from './product-attachments-native.mjs';
import {createTaskTransaction} from '../src/server/tasks/transaction.ts';
import {createProductCore} from '../src/server/products/core.ts';
import {readProductPercentageDefaults,saveProductPercentageDefaults} from '../src/server/product-percentage-defaults/core.ts';
let phase='guard';
const financeTables=['PayrollEntry','Payment','Payout','ProductStageSettlement','ProductStageSettlementShare','ProductPercentageCompletion','ProductPercentageCompletionShare'];
const ratesOf=rows=>Object.fromEntries(rows.map(row=>[row.kind,row.ratePercent===null?null:row.ratePercent.toFixed(1)]));
async function main(){
 const target=guard(),db=new PrismaClient(),checks=[],rollback=Error('EXPECTED_DEFAULT_PERCENTAGES_ROLLBACK');
 const originalFetch=globalThis.fetch;let externalFetchCalls=0;globalThis.fetch=async()=>{externalFetchCalls++;throw Error('NATIVE_EXTERNAL_FETCH_FORBIDDEN');};
 try{
  const before=await fingerprint(db);assert.ok(Object.keys(before).length>=41);
  await assert.rejects(db.$transaction(async tx=>{
   globalThis.__crmInlineTx=tx;let serial=0;
   const boundary=async fn=>{const name=`percentage_defaults_${++serial}`;await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);try{const result=await fn(tx);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);throw error;}};
   globalThis.__crmInlineTransaction=boundary;
   const transaction=createTaskTransaction({$transaction:boundary});
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
   const[identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name,current_schema() AS schema');assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
   const marker=randomUUID(),user=roles=>tx.user.create({data:{id:randomUUID(),name:'QA defaults '+marker,email:randomUUID()+'@invalid.test',passwordHash:'QA_DISABLED_NOT_A_PASSWORD_HASH',active:true,roles}});
   const manager=await user(['MANAGER']),combined=await user(['MANAGER','ENGINEER']),engineer=await user(['ENGINEER']),accountant=await user(['ACCOUNTANT']);
   const actor={id:manager.id,name:manager.name,roles:manager.roles,source:'api'},other={id:combined.id,name:combined.name,roles:combined.roles,source:'api'};
   const client=await tx.client.create({data:{id:randomUUID(),name:'QA defaults '+marker,phone:'100'}}),max=await tx.project.aggregate({_max:{numberInt:true}}),numberInt=(max._max.numberInt??0)+1;
   const project=await tx.project.create({data:{id:randomUUID(),number:String(numberInt),numberInt,title:'QA defaults '+marker,clientId:client.id,currency:'BYN'}});
   const old=await tx.product.create({data:{id:randomUUID(),projectId:project.id,number:project.number+'.1',suffixInt:1,title:'Existing product',quantity:3,expectedPrice:'1000',initialPrice:'999'}});
   const oldConfig=await tx.productPercentageConfig.create({data:{productId:old.id,kind:'ENGINEERING',ratePercent:'9',revision:3}});
   await tx.productPercentageCompletion.create({data:{productId:old.id,kind:'ENGINEERING',state:'LEGACY_PROTECTED',statusAtCompletion:'PRODUCTION',priceSnapshot:'999',productCurrency:'BYN'}});
   const financialBefore=await fingerprint(tx),oldBefore=await tx.product.findUnique({where:{id:old.id}});
   const save=(who,rates,baseline,id=randomUUID())=>transaction(inner=>saveProductPercentageDefaults(who,{rates,expectedRates:baseline.rates,expectedRevision:baseline.revision,clientMutationId:id},inner));
   phase='null_defaults';let current=await readProductPercentageDefaults(tx);let result=await save(actor,{ENGINEERING:null,ASSEMBLY:null,INSTALLATION:null},current);assert.equal(result.ok,true);current=result.snapshot;
   const empty=await createProductCore(actor,{projectId:project.id,title:'New null rates'},transaction);assert.equal(empty.ok,true);const emptyConfigs=await tx.productPercentageConfig.findMany({where:{productId:empty.product.id}});assert.equal(emptyConfigs.length,3);assert.deepEqual(ratesOf(emptyConfigs),{ENGINEERING:null,ASSEMBLY:null,INSTALLATION:null});assert.ok(emptyConfigs.every(row=>row.revision===1));checks.push('new_product_all_three_NULL_configs_no_guess_no_assignees');
   phase='configured_CAS_audit_replay';const id=randomUUID(),beforeAudit=await tx.changeLog.count({where:{entity:'orgSetting',entityId:'productPercentageDefaults'}});result=await save(actor,{ENGINEERING:'5.1',ASSEMBLY:'0',INSTALLATION:null},current,id);assert.equal(result.ok,true);const copied=result.snapshot;
   assert.equal(await tx.changeLog.count({where:{entity:'orgSetting',entityId:'productPercentageDefaults'}}),beforeAudit+1);const replay=await save(actor,{ENGINEERING:'5.1',ASSEMBLY:'0',INSTALLATION:null},current,id);assert.equal(replay.ok,true);assert.equal(replay.repeated,true);assert.equal((await save(other,{ENGINEERING:'5.1',ASSEMBLY:'0',INSTALLATION:null},current,id)).kind,'validation');assert.equal((await save(actor,{ENGINEERING:'5.1',ASSEMBLY:'0',INSTALLATION:null},current)).kind,'conflict');checks.push('active_manager_three_rates_CAS_real_audit_replay_actor_binding');
   phase='one_snapshot_creation';let reads=0;const tracked=new Proxy(tx,{get(object,key){if(key==='orgSetting')return new Proxy(object.orgSetting,{get(delegate,name){if(name==='findUnique')return args=>{reads++;return delegate.findUnique(args)};const value=delegate[name];return typeof value==='function'?value.bind(delegate):value;}});const value=object[key];return typeof value==='function'?value.bind(object):value;}});
   const first=await createProductCore(actor,{projectId:project.id,title:'Copied rates'},fn=>fn(tracked));assert.equal(first.ok,true);assert.equal(reads,1);assert.equal(first.product.engineerId,null);assert.equal(first.product.assemblerId,null);assert.equal(first.product.mounterId,null);const firstConfigs=await tx.productPercentageConfig.findMany({where:{productId:first.product.id},orderBy:{kind:'asc'}});assert.equal(firstConfigs.length,3);assert.deepEqual(ratesOf(firstConfigs),{ASSEMBLY:'0.0',ENGINEERING:'5.1',INSTALLATION:null});assert.ok(firstConfigs.every(row=>row.revision===1));checks.push('real_create_core_single_defaults_read_all_three_zero_distinct_NULL');
   phase='future_only';result=await save(other,{ENGINEERING:'6.4',ASSEMBLY:'4.0',INSTALLATION:'7.2'},copied);assert.equal(result.ok,true);const second=await createProductCore(other,{projectId:project.id,title:'Later rates'},transaction);assert.equal(second.ok,true);assert.deepEqual(ratesOf(await tx.productPercentageConfig.findMany({where:{productId:second.product.id}})),{ENGINEERING:'6.4',ASSEMBLY:'4.0',INSTALLATION:'7.2'});assert.deepEqual(await tx.productPercentageConfig.findMany({where:{productId:first.product.id},orderBy:{kind:'asc'}}),firstConfigs);assert.deepEqual(await tx.product.findUnique({where:{id:old.id}}),oldBefore);assert.deepEqual(await tx.productPercentageConfig.findUnique({where:{id:oldConfig.id}}),oldConfig);const financialAfter=await fingerprint(tx);for(const table of financeTables)assert.deepEqual(financialAfter[table],financialBefore[table]);checks.push('changed_defaults_only_later_new_products_old_configs_and_seven_frozen_fact_tables_unchanged');
   phase='nonmanager_denied';const deniedBefore=await fingerprint(tx);for(const person of [engineer,accountant]){const who={id:person.id,name:person.name,roles:person.roles,source:'api'};assert.equal((await save(who,{ENGINEERING:'1',ASSEMBLY:'1',INSTALLATION:'1'},result.snapshot)).kind,'forbidden');}assert.deepEqual(await fingerprint(tx),deniedBefore);checks.push('nonmanager_before_read_or_write_no_table_changed');
   throw rollback;
  },{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000}),error=>error===rollback);
  assert.deepEqual(await fingerprint(db),before);assert.equal(externalFetchCalls,0);
  console.log(JSON.stringify({kind:'product-percentage-defaults-native',target,checks,rollbackVerified:true,externalFetchCalls,capturedTableCount:Object.keys(before).length,fingerprintProfile:'all-models-and-migrations-ApiToken.lastUsedAt-only-operational-v2',tables:before,scope:'actual settings/create SQL, audit and immutable financial facts inside one outer rollback; no hosted concurrency/browser proof'}));
 }finally{globalThis.fetch=originalFetch;delete globalThis.__crmInlineTx;delete globalThis.__crmInlineTransaction;await db.$disconnect();}
}
try{await main();}catch{console.log(JSON.stringify({kind:'product-percentage-defaults-native',status:'FAIL',phase}));process.exitCode=1;}
