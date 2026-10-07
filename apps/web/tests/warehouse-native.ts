import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {existingLocalCrmDatabaseUrl} from './helpers/local-crm-database';
import {warehouseMove,warehouseReadPositions} from '../src/server/warehouse/accounting';
import {warehouseMetadataGate} from '../src/server/warehouse/gate';

async function main(){
const db=new PrismaClient({datasourceUrl:existingLocalCrmDatabaseUrl()}),run=randomUUID(),abort=Error('WAREHOUSE94_NATIVE_ROLLBACK');
const sql=await readFile('prisma/migrations/20261007170000_warehouse_weighted_average/migration.sql','utf8');
async function inventory(){
 const names=await db.$queryRaw<{name:string}[]>`SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
 const state:Record<string,unknown>={};
 for(const{name}of names){const table='"'+name.replaceAll('"','""')+'"';state[name]=await db.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) h FROM (SELECT md5(to_jsonb(t)::text) h FROM ${table} t) x`);}
 return state;
}
const before=await inventory();let passed=false;
try{
 await db.$transaction(async tx=>{
  if(!Object.hasOwn(before,'WarehouseAccountingState'))for(const statement of sql.split(/(?=^CREATE (?:TABLE|FUNCTION|INDEX) )/m))if(statement.includes('CREATE '))await tx.$executeRawUnsafe(statement);
  assert.equal(await tx.warehouseAccountingState.count(),0,'existing local accounting must not be replaced');
  const protectedBefore=await tx.$queryRaw`SELECT warehouse_protected_snapshot() snapshot`;
  const prices=await tx.material.findMany({select:{id:true,purchasePrice:true,updatedAt:true},orderBy:{id:'asc'}});
  await tx.$queryRaw`SELECT warehouse_freeze(${run})`;
  await assert.rejects(()=>warehouseMetadataGate(tx),/Склад временно закрыт/);
  const receipt:{runId:string;state:{tables:Record<string,unknown>};warehouseGuard:unknown}={runId:run,state:{tables:{}},warehouseGuard:null};
  for(const table of ['Material','StockMovement','ProjectMaterial','WarehouseBalance','WarehouseMovementValuation']){
   const [row]=await tx.$queryRawUnsafe<{summary:unknown}[]>(`SELECT json_build_object('rows',count(*),'hash',md5(COALESCE(string_agg(h,'' ORDER BY h),''))) summary FROM (SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) x`);
   receipt.state.tables[table]=row.summary;
  }
  const [frozen]=await tx.$queryRaw<{guard:unknown}[]>`SELECT json_build_object('runId',"runId",'prices',md5("beforePrices"::text),'balances',md5("beforeBalances"::text)) guard FROM "WarehouseAccountingState" WHERE id='main'`;
  receipt.warehouseGuard=frozen.guard;
  const operatorGuard=(action:string)=>{const process=spawnSync('python',['../../deploy/tests/warehouse94_sql_guard.py',action],{input:JSON.stringify(receipt),encoding:'utf8'});assert.equal(process.status,0,process.stderr);return process.stdout;};
  const stockSql=operatorGuard('stock'),originalStock=await tx.$queryRawUnsafe(stockSql);
  const guard=operatorGuard('freeze');await tx.$executeRawUnsafe(guard);
  await tx.$queryRaw`SELECT warehouse_attach_recovery_proof(${run},${'b'.repeat(64)},${'c'.repeat(64)})`;
  await tx.$executeRawUnsafe(guard);
  await tx.$queryRaw`SELECT warehouse_zero_start(${run},${'b'.repeat(64)},${'c'.repeat(64)})`;
  assert.deepEqual(await tx.$queryRaw`SELECT warehouse_protected_snapshot() snapshot`,protectedBefore);
  assert.equal(await tx.material.count({where:{purchasePrice:{not:0}}}),0);
  await tx.$executeRawUnsafe('SAVEPOINT archived_guard_error');
  await assert.rejects(()=>tx.$executeRawUnsafe(guard),/WAREHOUSE_ARCHIVE_SNAPSHOT_CHANGED/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT archived_guard_error');
  await tx.$executeRawUnsafe(operatorGuard('restore'));
  await tx.$queryRaw`SELECT warehouse_restore_start(${run},${'b'.repeat(64)},${'c'.repeat(64)})`;
  assert.deepEqual(await tx.$queryRawUnsafe(stockSql),originalStock);
  assert.deepEqual(await tx.material.findMany({select:{id:true,purchasePrice:true,updatedAt:true},orderBy:{id:'asc'}}),prices);
  assert.deepEqual(await tx.$queryRaw`SELECT warehouse_protected_snapshot() snapshot`,protectedBefore);
  const secondRun=randomUUID();
  await tx.$queryRaw`SELECT warehouse_freeze(${secondRun})`;
  await tx.$queryRaw`SELECT warehouse_attach_recovery_proof(${secondRun},${'d'.repeat(64)},${'e'.repeat(64)})`;
  await tx.$queryRaw`SELECT warehouse_zero_start(${secondRun},${'d'.repeat(64)},${'e'.repeat(64)})`;
  await tx.$queryRaw`SELECT warehouse_activate(${secondRun})`;
  const tag='QA_WH94_'+randomUUID();
  const user=await tx.user.create({data:{id:tag,email:tag+'@qa.invalid',name:tag,passwordHash:'not-used',roles:['ADMIN']}});
  const client=await tx.client.create({data:{name:tag,phone:'0000000000'}});
  const project=await tx.project.create({data:{number:tag,numberInt:2000000094,title:tag,clientId:client.id}});
  const product=await tx.product.create({data:{projectId:project.id,number:tag+'.1',title:tag,status:'PRODUCTION'}});
  const material=await tx.material.create({data:{id:tag,name:tag,purchasePrice:0}});
  const originalDate=material.updatedAt;
  const line=await tx.projectMaterial.create({data:{productId:product.id,materialId:material.id,quantity:100}});
  const actor={id:user.id,roles:['ADMIN' as const]},requests:Array<Parameters<typeof warehouseMove>[2]>=[];
  for(const unitPrice of ['5','7','10']){
   const input={kind:'INCOME' as const,clientMutationId:randomUUID(),materialId:material.id,quantity:'10',unitPrice};
   requests.push(input);await warehouseMove(tx,actor,input);
  }
  assert.equal((await tx.material.findUniqueOrThrow({where:{id:material.id}})).purchasePrice!.toFixed(2),'7.33');
  assert.deepEqual((await tx.material.findUniqueOrThrow({where:{id:material.id}})).updatedAt,originalDate);
  assert.equal((await warehouseMove(tx,actor,requests[0])).repeated,true);
  await assert.rejects(()=>warehouseMove(tx,actor,{...requests[0],quantity:'11'}),/другими данными/);
  assert.equal(await tx.stockMovement.count({where:{materialId:material.id}}),3);
  assert.equal(await tx.domainEvent.count({where:{actor:actor.id,type:'stock.movement.created'}}),3);
  assert.equal(await tx.changeLog.count({where:{actorId:actor.id,entity:'stockMovement'}}),3);
  assert.equal((await warehouseMove(tx,actor,{...requests[0],clientMutationId:requests[0].clientMutationId.toUpperCase()})).repeated,true);
  const stableBalance=await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}});
  await tx.$executeRawUnsafe('CREATE FUNCTION warehouse94_fixture_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION \'WAREHOUSE94_INJECTED_FAILURE\'; END; $$ LANGUAGE plpgsql');
  await tx.$executeRawUnsafe('CREATE TRIGGER warehouse94_fixture_failure BEFORE UPDATE ON "ProjectMaterial" FOR EACH ROW EXECUTE FUNCTION warehouse94_fixture_failure()');
  await tx.$executeRawUnsafe('SAVEPOINT injected_error');
  await assert.rejects(()=>warehouseMove(tx,actor,{kind:'EXPENSE',clientMutationId:randomUUID(),projectMaterialId:line.id,quantity:'1'}),/WAREHOUSE94_INJECTED_FAILURE/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT injected_error');
  assert.deepEqual(await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}}),stableBalance);
  assert.equal(await tx.stockMovement.count({where:{materialId:material.id}}),3);
  assert.equal(await tx.warehouseMovementValuation.count({where:{movement:{materialId:material.id}}}),3);
  await tx.$executeRawUnsafe('DROP TRIGGER warehouse94_fixture_failure ON "ProjectMaterial"');
  await tx.$executeRawUnsafe('CREATE TRIGGER warehouse94_event_failure BEFORE INSERT ON "DomainEvent" FOR EACH ROW EXECUTE FUNCTION warehouse94_fixture_failure()');
  await tx.$executeRawUnsafe('SAVEPOINT injected_event_error');
  await assert.rejects(()=>warehouseMove(tx,actor,{kind:'INCOME',clientMutationId:randomUUID(),materialId:material.id,quantity:'1',unitPrice:'8'}),/WAREHOUSE94_INJECTED_FAILURE/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT injected_event_error');
  assert.deepEqual(await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}}),stableBalance);
  assert.equal(await tx.stockMovement.count({where:{materialId:material.id}}),3);
  assert.equal(await tx.warehouseMovementValuation.count({where:{movement:{materialId:material.id}}}),3);
  assert.equal(await tx.changeLog.count({where:{actorId:actor.id,entity:'stockMovement'}}),3);
  await tx.$executeRawUnsafe('DROP TRIGGER warehouse94_event_failure ON "DomainEvent"');
  const issue=await warehouseMove(tx,actor,{kind:'EXPENSE',clientMutationId:randomUUID(),projectMaterialId:line.id,quantity:'10'});
  assert.equal(issue.movement.totalByn!.toFixed(2),'73.33');
  assert.equal((await warehouseReadPositions(tx,[material.id])).positions.get(material.id)!.quantity,'20');
  assert.equal((await tx.material.findUniqueOrThrow({where:{id:material.id}})).purchasePrice!.toFixed(2),'7.33');
  await assert.rejects(()=>warehouseMove(tx,actor,{kind:'EXPENSE',clientMutationId:randomUUID(),projectMaterialId:line.id,quantity:'21'}),/Недостаточно/);
  await warehouseMove(tx,actor,{kind:'RETURN',clientMutationId:randomUUID(),projectMaterialId:line.id,quantity:'10',sourceMovementId:issue.movement.id});
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}})).valueByn.toFixed(9),'220.000000000');
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:line.id}})).issuedQty.toString(),'0');
  await tx.projectMaterial.update({where:{id:line.id},data:{issuedQty:5}});
  await assert.rejects(()=>warehouseMove(tx,actor,{kind:'RETURN',clientMutationId:randomUUID(),projectMaterialId:line.id,quantity:'2',unitPrice:0}),/Цена должна/);
  await warehouseMove(tx,actor,{kind:'RETURN',clientMutationId:randomUUID(),projectMaterialId:line.id,quantity:'2',unitPrice:11});
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}})).quantity.toString(),'32');
  const tiny=await tx.material.create({data:{id:tag+'_tiny',name:tag+'_tiny',purchasePrice:0}});
  const tinyLine=await tx.projectMaterial.create({data:{productId:product.id,materialId:tiny.id,quantity:1}});
  await warehouseMove(tx,actor,{kind:'INCOME',clientMutationId:randomUUID(),materialId:tiny.id,quantity:'1',unitPrice:'0.02'});
  const tinyIssue=await warehouseMove(tx,actor,{kind:'EXPENSE',clientMutationId:randomUUID(),projectMaterialId:tinyLine.id,quantity:'1'});
  for(let i=0;i<4;i++)await warehouseMove(tx,actor,{kind:'RETURN',clientMutationId:randomUUID(),projectMaterialId:tinyLine.id,quantity:'0.25',sourceMovementId:tinyIssue.movement.id});
  assert.equal((await tx.warehouseMovementValuation.findUniqueOrThrow({where:{movementId:tinyIssue.movement.id}})).returnedMoneyByn.toFixed(2),'0.02');
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:tiny.id}})).valueByn.toFixed(9),'0.020000000');
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:tinyLine.id}})).issuedQty.toString(),'0');
  await tx.$executeRawUnsafe('SAVEPOINT unsafe_restore');
  await assert.rejects(()=>tx.$queryRaw`SELECT warehouse_restore_start(${secondRun},${'d'.repeat(64)},${'e'.repeat(64)})`,/WAREHOUSE_NEW_MOVEMENTS_REQUIRE_SELECTIVE_RECOVERY/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT unsafe_restore');
  const q=(await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}})).quantity.toString();
  await tx.$queryRaw`SELECT warehouse_zero_start(${secondRun},${'d'.repeat(64)},${'e'.repeat(64)})`;
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}})).quantity.toString(),q);
  passed=true;throw abort;
 },{maxWait:10000,timeout:120000});
}catch(error){if(error!==abort)throw error;}
finally{assert.deepEqual(await inventory(),before,'all original rows and table inventory must return after rollback');await db.$disconnect();}
assert.ok(passed);
console.log(JSON.stringify({status:'PASS',target:'existing local 5433',schemaAndAllRows:'ROLLED_BACK',math:true,resetAndTargetedRestore:true,updatedAtPreserved:true,duplicateRequest:true,noDoubleIncome:true,newWritesPreventBlindRestore:true,archiveSnapshotGuard:true,eventFailureRollsBackBalanceAndAudit:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
