/** Read-only diagnosis only: no observation signing, cleanup, baseline edits or exclusions beyond exact owned effects. */
import {PrismaClient} from '@prisma/client';
import {envelope,guard,verify,dbGuard,snapshot,ownExclusions,effects,actorGuard,idsOf} from './product-inline-fixture-v1-internals.mjs';
const requireThat=(ok,code)=>{if(!ok)throw new Error(code)};
let phase='guard';
async function main(){let db;try{
 const input=envelope();requireThat(input?.operation==='inspect','INSPECT_OPERATION_REQUIRED');const{target,secret}=guard();verify(input.checkpoint,secret,'checkpoint');const cp=input.checkpoint;requireThat(cp.target===target,'CHECKPOINT_TARGET_MISMATCH');
 db=new PrismaClient({log:[],errorFormat:'minimal'});phase='readonly_fingerprints';
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await dbGuard(tx,target);const[mode]=await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS mode");requireThat(mode.mode==='on','READ_ONLY_TRANSACTION_REQUIRED');
  await actorGuard(tx,cp);const ownEffects=await effects(tx,cp,input.mutationIds);const current=await snapshot(tx,ownExclusions(cp,idsOf(ownEffects)));
  const changedTables=Object.keys(cp.baseline).filter(table=>current[table]?.hash!==cp.baseline[table].hash||current[table]?.count!==cp.baseline[table].count).map(table=>({table,baseline:cp.baseline[table],current:current[table],countDelta:Number(current[table]?.count)-Number(cp.baseline[table].count)}));
  const enabledPluginIds=(await tx.plugin.findMany({where:{enabled:true},select:{id:true},orderBy:{id:'asc'}})).map(row=>row.id);
  const anchor=new Date(Math.min(...cp.originalRows.clients.map(row=>new Date(row.createdAt).getTime())));requireThat(Number.isFinite(anchor.getTime()),'OWNED_CREATION_ANCHOR_REQUIRED');
  const diagnostics={};
  if(changedTables.some(row=>row.table==='ApiToken')){const rows=await tx.apiToken.findMany({select:{id:true,createdAt:true,lastUsedAt:true},orderBy:{id:'asc'},take:500});diagnostics.ApiToken={rows:rows.map(row=>({id:row.id,createdAt:row.createdAt.toISOString(),lastUsedAt:row.lastUsedAt?.toISOString()??null,createdAtOrAfterOwnedAnchor:row.createdAt>=anchor,lastUseAtOrAfterOwnedAnchor:row.lastUsedAt!==null&&row.lastUsedAt>=anchor})),truncated:rows.length===500,baselineFieldValuesUnavailable:true};}
  if(changedTables.some(row=>row.table==='PluginRunLog')){const rows=await tx.pluginRunLog.findMany({where:{createdAt:{gte:anchor}},select:{id:true,pluginId:true,createdAt:true},orderBy:{createdAt:'asc'},take:500});diagnostics.PluginRunLog={rows:rows.map(row=>({id:row.id,pluginId:row.pluginId,createdAt:row.createdAt.toISOString()})),truncated:rows.length===500,exactOwnedEventAssociationUnavailable:true};}
  return{status:'DIAGNOSED',readOnly:true,target,runId:cp.runId,changedTables,enabledPluginIds,diagnostics,ownedCreationAnchor:anchor.toISOString(),anchorRelationToBaseline:"NOT_PROVEN",baselinePerRowIdsUnavailable:true,cleanupAuthorized:false,checkpointUnchanged:true};
 },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});console.log(JSON.stringify(result));
 }catch(error){console.error(JSON.stringify({phase,errorName:error.name??'UnknownError',errorCode:error.code??null,sqlState:error.meta?.code??null}));console.log(JSON.stringify({status:'FAIL',phase,code:/^[A-Z0-9_]+$/.test(error.message??'')?error.message:'READONLY_DIAGNOSTIC_FAILED'}));process.exitCode=1;}finally{if(db)await db.$disconnect().catch(()=>{})}}
await main();
