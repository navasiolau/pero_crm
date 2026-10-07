import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {PrismaClient,Prisma} from '@prisma/client';
import {createProductCore} from '../src/server/products/core';
import {changeProductStatusTransaction} from '../src/server/products/status-core';
import {productVisibilityWhere,projectVisibilityWhere} from '../src/server/access/visibility';
let phase='guard';
const target=process.env.CRM_MODERNIZATION_TARGET,url=new URL(process.env.DATABASE_URL??'');
assert.equal(url.protocol,'postgresql:');assert.equal(url.searchParams.get('schema')??'public','public');
if(target==='local'){assert.equal(process.platform,'win32');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');}
else if(target==='staging'){assert.ok(existsSync('/.dockerenv')&&/^[a-f0-9]{12,64}$/.test(hostname()));assert.equal(url.hostname,'db');assert.equal(url.pathname,'/crm');assert.equal(process.env.S3_BUCKET,'pero-crm-staging');const proof=JSON.parse(process.env.CRM_MODERNIZATION_STAGE_PROOF??'');assert.equal(proof.hostname,'crm-staging');assert.equal(proof.databaseVolume,'crm-staging_pgdata');assert.match(proof.revision,/^[a-f0-9]{40}$/);assert.match(proof.outerW07Sha256,/^[a-f0-9]{64}$/);}
else throw Error('EXPLICIT_LOCAL_STAGING_TARGET_REQUIRED');
const db=new PrismaClient(),tables=[...Object.values(Prisma.ModelName),'_prisma_migrations'];
async function fingerprint(client){const result={};for(const table of tables){assert.match(table,/^[A-Za-z_][A-Za-z0-9_]*$/);const row=table==='ApiToken'?"(to_jsonb(t) - 'lastUsedAt')::text":'row_to_json(t)::text';const[value]=await client.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(${row},'' ORDER BY ${row}),'')) AS hash FROM "${table}" t`);result[table]=value;}return result;}
try{
 phase='baseline';const before=await fingerprint(db),checks=[];const rollback=Error('EXPECTED_PREPARATION_ROLLBACK');
 await assert.rejects(db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
  const[identity]=await tx.$queryRaw`SELECT current_database() AS name,current_schema() AS schema`;assert.equal(identity.name,target==='local'?'pero_crm':'crm');assert.equal(identity.schema,'public');
  const actor=async role=>({...await tx.user.create({data:{id:randomUUID(),email:`qa96-${randomUUID()}@invalid.test`,name:'QA preparation 96',passwordHash:'QA_DISABLED_NOT_A_PASSWORD',roles:[role]},select:{id:true,name:true,roles:true}}),source:'web'});
  const manager=await actor('MANAGER'),engineer=await actor('ENGINEER'),worker=await actor('WORKER'),mounter=await actor('MOUNTER');
  const client=await tx.client.create({data:{name:'QA preparation client',phone:'100'}}),max=await tx.project.aggregate({_max:{numberInt:true}}),numberInt=(max._max.numberInt??0)+1;
  const project=await tx.project.create({data:{number:String(numberInt),numberInt,title:'QA preparation project',currency:'BYN',clientId:client.id,managerId:manager.id}});
  phase='creation';const result=await createProductCore(manager,{projectId:project.id,title:'QA preparation product',engineerId:engineer.id,expectedPrice:100},operation=>operation(tx));assert.equal(result.ok,true);const product=result.product;
  assert.equal(product.status,'PREPARATION');const first=await tx.productStatusHistory.findMany({where:{productId:product.id}});assert.equal(first.length,1);assert.equal(first[0].fromStatus,null);assert.equal(first[0].toStatus,'PREPARATION');
  const direct=await tx.product.create({data:{projectId:project.id,number:`${project.number}.2`,suffixInt:2,title:'QA database default'}});assert.equal(direct.status,'PREPARATION');checks.push('real_create_core_and_database_default_initial_history');
  await tx.product.update({where:{id:product.id},data:{assemblerId:worker.id,mounterId:mounter.id}});
  phase='access';for(const user of [engineer,worker,mounter]){assert.equal(await tx.product.findFirst({where:{AND:[{id:product.id},productVisibilityWhere(user)]}}),null);assert.equal(await tx.project.findFirst({where:{AND:[{id:project.id},projectVisibilityWhere(user)]}}),null);}
  assert.equal((await tx.product.findFirst({where:{AND:[{id:product.id},productVisibilityWhere(manager)]}})).id,product.id);
  const denied=await changeProductStatusTransaction(tx,engineer,product.id,'DESIGN');assert.equal(denied.ok,false);assert.equal((await tx.product.findUnique({where:{id:product.id}})).status,'PREPARATION');checks.push('actual_SQL_preparation_denies_engineer_worker_mounter_manager_allowed');
  phase='transitions';assert.equal((await changeProductStatusTransaction(tx,manager,product.id,'DESIGN')).ok,true);assert.equal((await tx.product.findFirst({where:{AND:[{id:product.id},productVisibilityWhere(engineer)]}})).id,product.id);
  assert.equal((await changeProductStatusTransaction(tx,manager,product.id,'PREPARATION')).ok,true);
  assert.equal(await tx.payrollEntry.count({where:{projectId:project.id}}),0);assert.equal(await tx.productPercentageCompletion.count({where:{productId:product.id}}),0);assert.equal(await tx.productStatusHistory.count({where:{productId:product.id}}),3);checks.push('management_roundtrip_history_without_payroll_or_completion');
  throw rollback;
 },{maxWait:10000,timeout:120000}),error=>error===rollback);
 phase='verify_rollback';assert.deepEqual(await fingerprint(db),before);
 console.log(JSON.stringify({kind:'product-preparation-native',target,status:'PASS',checks,rollbackVerified:true,tables:before}));
}catch(error){console.log(JSON.stringify({kind:'product-preparation-native',target,status:'FAIL',phase}));console.error(error);process.exitCode=1;}finally{await db.$disconnect();}
