// Root-only runner113. Только build/import без --authorized; transport через существующий guarded wrapper.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {qaTransport,bundleHash,acceptanceWeb} from './crm-acceptance-transport.mjs';
import {MIGRATION,WIRE_LIMIT,canonical,verifyBefore,verifyAfter} from './file-sections-staging-readonly.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(acceptanceWeb,'../..'),results=path.join(acceptanceWeb,'test-results');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=(ok,code)=>{if(!ok)throw Error(code);},sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b,code)=>need(canonical(a)===canonical(b),code);
export function verifiedMigrationChecksum(bytes){
 const checksum=sha(Buffer.from(bytes).toString('utf8').replaceAll('\r\n','\n'));need(checksum===MIGRATION.checksum,'APPROVED_SQL_CHECKSUM_CHANGED');return {...MIGRATION};
}
export function validateOptions(options){
 need(options&&Object.keys(options).every(key=>['mode','authorized','revision','runId','outputDir','beforeFile','beforeSha256'].includes(key)),'RUNNER_FIELDS_INVALID');
 need(options.authorized===true&&['before','after'].includes(options.mode)&&REV.test(options.revision??'')&&UUID.test(options.runId??''),'AUTHORIZED_FULL_REVISION_REQUIRED');
 need(path.isAbsolute(options.outputDir??''),'ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
 if(options.mode==='before')need(options.beforeFile===undefined&&options.beforeSha256===undefined,'BEFORE_PRIOR_FORBIDDEN');
 else need(path.isAbsolute(options.beforeFile??'')&&SHA.test(options.beforeSha256??''),'HASHED_BEFORE_REQUIRED');
 return options;
}
function privatePath(file){
 const absolute=path.resolve(file),relative=path.relative(results,absolute);need(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'IGNORED_PRIVATE_RESULTS_REQUIRED');
 need(existsSync(results)&&realpathSync(results).toLowerCase()===results.toLowerCase()&&!lstatSync(results).isSymbolicLink(),'PRIVATE_RESULTS_ROOT_REQUIRED');
 let ancestor=absolute;while(ancestor.toLowerCase()!==results.toLowerCase()){if(existsSync(ancestor))need(!lstatSync(ancestor).isSymbolicLink(),'PRIVATE_REPARSE_POINT_STOP');const parent=path.dirname(ancestor);need(parent!==ancestor,'PRIVATE_ANCESTOR_STOP');ancestor=parent;}
 return absolute;
}
function publish(file,value){
 const absolute=privatePath(file);need(!existsSync(absolute),'IMMUTABLE_PROOF_EXISTS');
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');need(bytes.length<=128*1024,'PRIVATE_PROOF_SIZE_LIMIT');
 const temporary=privatePath(path.join(path.dirname(absolute),'.writing-'+randomUUID())),fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,absolute);
 return {file:absolute,sha256:sha(bytes)};
}
function sources(){
 const out={};for(const name of ['file-sections-staging-readonly.mjs','file-sections-staging-runner.mjs','crm-acceptance-token-clock.mjs','crm-acceptance-transport.mjs'])out[name]=sha(readFileSync(path.join(here,name)));
 out['crm-modernization-staging.py']=sha(readFileSync(path.join(root,'deploy/acceptance/crm-modernization-staging.py')));return out;
}
function approvedSql(){return verifiedMigrationChecksum(readFileSync(path.join(acceptanceWeb,'prisma/migrations',MIGRATION.name,'migration.sql')));}
export async function fileSectionsStagingBundle(){
 const result=await build({entryPoints:[path.join(here,'file-sections-staging-readonly.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,logLevel:'silent'});
 const bytes=Buffer.from(result.outputFiles[0].contents);need(bytes.length>0&&bytes.length<=256*1024,'EXISTING_BUNDLE_CAP_EXCEEDED');return bytes;
}
export function verifiedResponse(result,input,expectedBundleSha){
 need(result?.body?.status==='READ_ONLY_CAPTURED'&&result.body.mode===input.mode&&result.body.runId===input.runId&&result.body.revision===input.revision,'CAPTURE_RESPONSE_BINDING_INVALID');
 need(Buffer.byteLength(JSON.stringify(result.body))<=WIRE_LIMIT,'READONLY_WIRE_LIMIT');
 const identity=result.receipt?.identity;need(identity&&identity.hostname==='crm-staging'&&identity.revision===input.revision&&result.receipt.bundleSha256===expectedBundleSha&&result.receipt.operation==='inspect'&&result.receipt.exitCode===0,'LOCKED_WRAPPER_RECEIPT_INVALID');
 need(identity.databaseVolume==='crm-staging_pgdata'&&SHA.test(identity.database??'')&&SHA.test(identity.web??'')&&SHA.test(identity.outerW07Sha256??'')&&typeof identity.databaseStartedAt==='string','PHYSICAL_RECEIPT_INVALID');
 need(result.body.snapshot!==null&&typeof result.body.snapshot==='object'&&!Array.isArray(result.body.snapshot),'AGGREGATE_SNAPSHOT_REQUIRED');return result.body.snapshot;
}
export async function runFileSectionsStagingProof(options){
 validateOptions(options);privatePath(options.outputDir);mkdirSync(options.outputDir,{recursive:true});need(!existsSync(privatePath(path.join(options.outputDir,options.mode+'-proof.json'))),'IMMUTABLE_PROOF_EXISTS');
 const sourceHashes=sources(),expectedMigration=approvedSql(),bytes=await fileSectionsStagingBundle(),bundleSha256=bundleHash(bytes);
 const input={operation:'inspect',authorized:true,mode:options.mode,revision:options.revision,runId:options.runId,expectedMigration};let previous;
 if(options.mode==='after'){
  const beforeBytes=readFileSync(privatePath(options.beforeFile));need(beforeBytes.length<=128*1024&&sha(beforeBytes)===options.beforeSha256,'BEFORE_BYTES_DIGEST_INVALID');previous=JSON.parse(beforeBytes.toString('utf8'));
  need(previous?.kind==='file-sections-staging-before'&&previous.version===2&&previous.runId===options.runId&&REV.test(previous.revision??'')&&previous.revision!==options.revision,'BEFORE_PROOF_BINDING_INVALID');
  same(previous.sources,sourceHashes,'PROOF_SOURCE_CHANGED');same(previous.expectedMigration,expectedMigration,'PROOF_MIGRATION_CHANGED');need(previous.bundleSha256===bundleSha256&&previous.identity?.hostname==='crm-staging'&&previous.identity.revision===previous.revision,'BEFORE_BUNDLE_IDENTITY_INVALID');
  verifyBefore(previous.snapshot,{...input,mode:'before',revision:previous.revision});
 }
 const transport=qaTransport({target:'staging',revision:options.revision,outputDir:options.outputDir});
 const result=await transport.execute(bytes,'inspect',input),snapshot=verifiedResponse(result,input,bundleSha256);same(sources(),sourceHashes,'CAPTURE_SOURCE_CHANGED');
 const verification=options.mode==='before'?verifyBefore(snapshot,input):verifyAfter(previous.snapshot,snapshot,{...input,beforeRevision:previous.revision});
 if(previous)for(const key of ['database','databaseStartedAt','databaseVolume','outerW07Sha256'])same(result.receipt.identity[key],previous.identity[key],'PHYSICAL_STAGE_CHANGED_'+key.toUpperCase());
 const descriptor={kind:'file-sections-staging-'+options.mode,version:2,runId:options.runId,revision:options.revision,sources:sourceHashes,expectedMigration,bundleSha256,identity:result.receipt.identity,snapshot,verification,...(previous?{beforeSha256:options.beforeSha256,beforeRevision:previous.revision}:{})};
 const saved=publish(path.join(options.outputDir,options.mode+'-proof.json'),descriptor);
 return {status:options.mode==='before'?'BEFORE_CAPTURED':'AFTER_VERIFIED',mode:options.mode,runId:options.runId,revision:options.revision,...saved,verification,readOnly:true,fixturesCreated:false,migrationExecuted:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 try{
  if(mode==='build'){
   need(args.length===1&&path.isAbsolute(args[0]),'EXPLICIT_BUILD_OUTPUT_REQUIRED');approvedSql();const bytes=await fileSectionsStagingBundle(),out=privatePath(args[0]);mkdirSync(path.dirname(out),{recursive:true});const fd=openSync(out,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
   console.log(JSON.stringify({status:'BUILT',out,bytes:bytes.length,sha256:bundleHash(bytes),stageExecuted:false,dbExecuted:false}));
  }else{
   const [revision,runId,outputDir,...flags]=args;let beforeFile,beforeSha256;
   if(mode==='before')need(flags.length===1&&flags[0]==='--authorized','EXPLICIT_ROOT_REVIEW_REQUIRED');
   else{need(mode==='after'&&flags.length===5&&flags[0]==='--before'&&flags[2]==='--before-sha256'&&flags[4]==='--authorized','EXPLICIT_HASHED_BEFORE_REQUIRED');beforeFile=flags[1];beforeSha256=flags[3];}
   console.log(JSON.stringify(await runFileSectionsStagingProof({mode,revision,runId,outputDir,beforeFile,beforeSha256,authorized:true})));
  }
 }catch(error){console.log(JSON.stringify({status:'STOP',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'TASK113_READONLY_PROOF_STOP',mode,stageMutationExecuted:false}));process.exitCode=1;}
}
