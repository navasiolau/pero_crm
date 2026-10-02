/** Explicit owned-only reconciliation of failed V1 QA, never an old baseline restore. */
import {PrismaClient} from '@prisma/client';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {envelope,guard,verify,dbGuard,snapshot,ownExclusions,effects,actorGuard,ownedRows,immutableRows,noDependencies,idsOf,canonical,hash} from './product-inline-fixture-v1-internals.mjs';
const NS='PERO_PRODUCT_INLINE_V1_OWNED_RECONCILIATION_V1';
const requireThat=(ok,code)=>{if(!ok)throw new Error(code)};
function signature(value,secret){const payload={...value};delete payload.signature;return createHmac('sha256',secret).update(NS).update(canonical(payload)).digest('hex')}
function verifyObservation(value,secret,cp,target){requireThat(value?.namespace===NS&&value.runId===cp.runId&&value.target===target&&value.checkpointHash===hash(cp)&&/^[a-f0-9]{64}$/.test(value.signature??''),'RECONCILIATION_SCOPE_INVALID');requireThat(timingSafeEqual(Buffer.from(value.signature,'hex'),Buffer.from(signature(value,secret),'hex')),'RECONCILIATION_SIGNATURE_MISMATCH')}
function outsideGuard(current,cp){requireThat(current.ApiToken&&cp.baseline.ApiToken&&current.ApiToken.count===cp.baseline.ApiToken.count,'APITOKEN_ROW_COUNT_CHANGED_STOP');for(const table of Object.keys(cp.baseline)){if(table==='ApiToken')continue;requireThat(canonical(current[table])===canonical(cp.baseline[table]),`ORIGINAL_${table}_CHANGED_STOP`)}}
function observationCas(state,obs){requireThat(canonical(state.rows)===canonical(obs.ownedRows),'OWNED_ROW_CAS_CONFLICT_STOP');requireThat(canonical(state.sideEffects)===canonical(obs.effects),'OWNED_EFFECT_CAS_CONFLICT_STOP');requireThat(canonical(state.outside)===canonical(obs.currentOutsideRaw),'CURRENT_RAW_SECURITY_CAS_CONFLICT_STOP')}
async function gather(tx,cp,mutationIds){await actorGuard(tx,cp);await noDependencies(tx,cp);const rows=await ownedRows(tx,cp);immutableRows(cp,rows);const sideEffects=await effects(tx,cp,mutationIds);const outside=await snapshot(tx,ownExclusions(cp,idsOf(sideEffects)));outsideGuard(outside,cp);return{rows,sideEffects,outside}}
async function main(){let db;let phase='guard';try{
 const input=envelope();requireThat(['inspect','restore'].includes(input?.operation),'RECONCILIATION_OPERATION_REQUIRED');const{target,secret}=guard();verify(input.checkpoint,secret,'checkpoint');const cp=input.checkpoint;requireThat(cp.target===target,'CHECKPOINT_TARGET_MISMATCH');if(input.operation==='restore')verifyObservation(input.observation,secret,cp,target);
 db=new PrismaClient({log:[],errorFormat:'minimal'});phase=input.operation;
 const result=await db.$transaction(async tx=>{
  if(input.operation==='inspect'){
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await dbGuard(tx,target);const[mode]=await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS mode");requireThat(mode.mode==='on','READONLY_REQUIRED');
   const state=await gather(tx,cp,input.mutationIds);const observation={namespace:NS,runId:cp.runId,target,checkpointHash:hash(cp),mutationIds:input.mutationIds,ownedRows:state.rows,effects:state.sideEffects,currentOutsideRaw:state.outside,originalV1ApiTokenMatch:'NOT_PROVEN',onlyLastUsedAtDriftNotProven:true};observation.signature=signature(observation,secret);
   return{status:'OBSERVED_RECONCILIATION',readOnly:true,observation,allOtherOriginalTables:'MATCH',currentApiTokenRaw:state.outside.ApiToken,originalV1ApiTokenMatch:'NOT_PROVEN',cleanupExecuted:false};
  }
  await dbGuard(tx,target);await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
  // A short table SHARE lock also excludes concurrent token insertion, which
  // per-row FOR SHARE alone cannot prevent. No ApiToken field is written.
  await tx.$executeRawUnsafe('LOCK TABLE "ApiToken" IN SHARE MODE');await tx.$queryRawUnsafe('SELECT id FROM "ApiToken" ORDER BY id FOR SHARE');
  const obs=input.observation;const state=await gather(tx,cp,obs.mutationIds);observationCas(state,obs);
  const currentBefore=await snapshot(tx);const counts={};for(const table of ['Notification','DomainEvent','ChangeLog','ProductStatusHistory']){const model=table[0].toLowerCase()+table.slice(1),ids=state.sideEffects[table].map(row=>row.id);const deleted=await tx[model].deleteMany({where:{id:{in:ids}}});requireThat(deleted.count===ids.length,'EXACT_OWNED_EFFECT_DELETE_MISMATCH_STOP');counts[table]=deleted.count;}
  requireThat((await tx.product.deleteMany({where:{id:{in:[cp.ids.productA,cp.ids.productB]},projectId:cp.ids.project}})).count===2,'EXACT_OWNED_PRODUCT_DELETE_MISMATCH_STOP');requireThat((await tx.project.deleteMany({where:{id:cp.ids.project}})).count===1,'EXACT_OWNED_PROJECT_DELETE_MISMATCH_STOP');requireThat((await tx.client.deleteMany({where:{id:{in:[cp.ids.clientA,cp.ids.clientB]}}})).count===2,'EXACT_OWNED_CLIENT_DELETE_MISMATCH_STOP');
  const currentAfter=await snapshot(tx);requireThat(canonical(currentAfter)===canonical(state.outside),'CURRENT_RAW_DATA_NOT_PRESERVED_STOP');requireThat(canonical(currentBefore.ApiToken)===canonical(currentAfter.ApiToken),'CURRENT_RAW_APITOKEN_NOT_PRESERVED_STOP');outsideGuard(currentAfter,cp);
  return{status:'RECONCILED',runId:cp.runId,counts:{...counts,Product:2,Project:1,Client:2},allOtherOriginalTables:'MATCH',originalV1ApiTokenMatch:'NOT_PROVEN',onlyLastUsedAtDriftNotProven:true,currentSecurityPreserved:'PASS',currentApiTokenRawBefore:currentBefore.ApiToken,currentApiTokenRawAfter:currentAfter.ApiToken,noApiTokenWrites:true,preferences:'SEPARATE_SESSION_CAS_RESTORE_REQUIRED'};
 },{isolationLevel:input.operation==='inspect'?'RepeatableRead':'Serializable',maxWait:10000,timeout:120000});console.log(JSON.stringify(result));
 }catch(error){console.error(JSON.stringify({phase,errorName:error.name??'UnknownError',errorCode:error.code??null,sqlState:error.meta?.code??null}));console.log(JSON.stringify({status:'FAIL',phase,code:/^[A-Z0-9_]+$/.test(error.message??'')?error.message:'RECONCILIATION_STOP_PRESERVE_STATE'}));process.exitCode=1;}finally{if(db)await db.$disconnect().catch(()=>{})}}
await main();
