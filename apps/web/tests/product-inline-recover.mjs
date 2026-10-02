// Explicit root recovery only. No browser requests, guessed writes, or guard bypass.
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {qaTransport,qaBundle,acceptanceRoot} from './crm-acceptance-transport.mjs';
const [target,revision,directory]=process.argv.slice(2);
const requireThat=(ok,code)=>{if(!ok)throw new Error(code)};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
async function main(){
 requireThat(['local','staging'].includes(target)&&/^[a-f0-9]{40}$/.test(revision??''),'EXPLICIT_TARGET_REVISION_REQUIRED');
 requireThat(typeof directory==='string'&&path.isAbsolute(directory),'EXACT_ABSOLUTE_OUTPUT_DIRECTORY_REQUIRED');
 const base=path.resolve(acceptanceRoot,'.playwright-mcp','modernization');const outputDir=path.resolve(directory);
 requireThat(normalize(path.dirname(outputDir))===normalize(base),'OUTPUT_DIRECTORY_OUTSIDE_IGNORED_WORKSPACE');
 const prefix=`${target}-inline-browser-`;requireThat(path.basename(outputDir).startsWith(prefix)&&uuid(path.basename(outputDir).slice(prefix.length)),'EXACT_RECORDED_RUN_DIRECTORY_REQUIRED');
 for(const item of [acceptanceRoot,path.join(acceptanceRoot,'.playwright-mcp'),base,outputDir]){const info=await lstat(item);requireThat(info.isDirectory()&&!info.isSymbolicLink(),'RECOVERY_REPARSE_PATH_STOP');requireThat(normalize(await realpath(item))===normalize(path.resolve(item)),'RECOVERY_CANONICAL_PATH_STOP');}
 async function json(name){const file=path.join(outputDir,name);const info=await lstat(file);requireThat(info.isFile()&&!info.isSymbolicLink(),'RECOVERY_FILE_SCOPE_STOP');requireThat(normalize(await realpath(file))===normalize(file),'RECOVERY_FILE_CANONICAL_STOP');return JSON.parse(await readFile(file,'utf8'));}
 const fixture=await json('fixture-checkpoint.json');const session=await json('session-checkpoint.json');const journal=await json('product-inline-owned-writes.json');const requests=await json('product-inline-request-journal.json');
 requireThat(fixture.target===target&&uuid(fixture.runId)&&fixture.namespace==='PERO_PRODUCT_INLINE_BROWSER_FIXTURES_V1','RECORDED_FIXTURE_SCOPE_MISMATCH');
 requireThat(Array.isArray(journal.ownWrites)&&Array.isArray(journal.preferenceOwnWrites)&&Array.isArray(requests),'CAPTURED_JOURNALS_REQUIRED');
 const actorIds=Object.values(fixture.actors).map(actor=>actor.id);const products=[fixture.ids.productA,fixture.ids.productB];const mutations=new Set();
 for(const write of journal.ownWrites){requireThat(actorIds.includes(write.actorId)&&products.includes(write.productId)&&uuid(write.clientMutationId),'CAPTURED_WRITE_SCOPE_MISMATCH');if(!write.noOp)mutations.add(write.clientMutationId);}
 // A response durably captured before the ownWrites callback is still direct
 // success evidence. Never authorize pending/intended/failed request snapshots.
 for(const request of requests){if(request.type!=='patch'||request.phase!=='response-captured'||request.httpStatus!==200||request.result?.kind!=='saved')continue;
  requireThat(actorIds.includes(request.actorId)&&products.includes(request.request?.productId)&&uuid(request.result.clientMutationId)&&request.result.clientMutationId===request.request.clientMutationId&&request.result.field===request.request.field,'CAPTURED_RESPONSE_SCOPE_MISMATCH');if(!request.result.noOp)mutations.add(request.result.clientMutationId);
 }
 const transport=qaTransport({target,revision,outputDir});const fixtures=await qaBundle('product-inline-browser-fixtures.mjs'),sessions=await qaBundle('crm-modernization-session.mjs');
 const save=(name,value)=>writeFile(path.join(outputDir,name),JSON.stringify(value,null,2),{mode:0o600});
 const observed=await transport.execute(fixtures,'inspect',{operation:'inspect',checkpoint:fixture,mutationIds:[...mutations]});await save('recovery-fixture-observation.json',observed.body.observation);
 const cleaned=await transport.execute(fixtures,'restore',{operation:'restore',checkpoint:fixture,observation:observed.body.observation});await save('recovery-fixture-cleanup.json',cleaned.receipt);
 requireThat(cleaned.body.status==='CLEANED','FIXTURE_CLEANUP_NOT_CONFIRMED_STOP');
 const preferences=await transport.execute(sessions,'restore',{operation:'restore',checkpoint:session,ownWrites:journal.preferenceOwnWrites});await save('recovery-preference-cleanup.json',preferences.receipt);
 requireThat(preferences.body.status==='RESTORED','PREFERENCE_CLEANUP_NOT_CONFIRMED_STOP');
 console.log(JSON.stringify({status:'RECOVERED',target,revision,outputDir,fixtures:cleaned.body.counts,preferences:preferences.body.counts,mutationReceipts:mutations.size}));
}
main().catch(error=>{const code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'RECOVERY_STOP_PRESERVE_STATE';console.error(JSON.stringify({status:'STOP',code,target,outputDir:directory}));process.exitCode=1;});
