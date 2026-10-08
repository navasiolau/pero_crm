// Root-only coordinator задачи110. Build/import не вызывает SSH, БД или S3.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,realpathSync,openSync,closeSync,fsyncSync,statSync} from 'node:fs';
import {qaTransport,bundleHash,acceptanceWeb} from './crm-acceptance-transport.mjs';
import {MIGRATION,canonical,verifyBefore,verifyAfter} from './warehouse-units-staging-readonly.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(acceptanceWeb,'../..'),results=path.join(acceptanceWeb,'test-results');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RAW_CAP=8*1024*1024,WIRE_CAP=250*1024;
export const APPROVED_MIGRATIONS=[MIGRATION];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const same=(a,b,code)=>need(canonical(a)===canonical(b),code);
export function verifiedMigrationChecksums(contents){
 need(Array.isArray(contents)&&contents.length===1,'EXACT_ONE_SQL_FILE_REQUIRED');const rows=contents.map(bytes=>({name:MIGRATION.name,checksum:sha(Buffer.from(bytes).toString('utf8').replaceAll('\r\n','\n'))}));same(rows,APPROVED_MIGRATIONS,'FROZEN_MIGRATION_SQL_CHANGED_STOP');return rows;
}
export function validateOptions(options){
 need(options&&Object.keys(options).every(key=>['mode','authorized','revision','runId','outputDir','beforeFile','beforeSha256'].includes(key)),'EXACT_RUNNER_OPTIONS_REQUIRED');
 need(options.authorized===true&&['before','after'].includes(options.mode)&&SHA40.test(options.revision??'')&&UUID.test(options.runId??''),'AUTHORIZED_EXACT_REVISION_REQUIRED');need(typeof options.outputDir==='string'&&path.isAbsolute(options.outputDir),'ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
 if(options.mode==='before')need(options.beforeFile===undefined&&options.beforeSha256===undefined,'BEFORE_HAS_NO_PRIOR_INPUT');else need(typeof options.beforeFile==='string'&&path.isAbsolute(options.beforeFile)&&SHA64.test(options.beforeSha256??''),'AFTER_HASHED_BEFORE_REQUIRED');return options;
}
const comparison=value=>process.platform==='win32'?value.toLowerCase():value;
function privatePath(file){
 const absolute=path.resolve(file),relative=path.relative(results,absolute);need(relative.length>0&&!relative.startsWith('..')&&!path.isAbsolute(relative),'PRIVATE_RESULTS_DESCENDANT_REQUIRED');
 need(existsSync(results)&&!lstatSync(results).isSymbolicLink()&&comparison(realpathSync(results))===comparison(results),'PRIVATE_RESULTS_ROOT_REQUIRED');
 let ancestor=absolute;while(comparison(ancestor)!==comparison(results)){if(existsSync(ancestor))need(!lstatSync(ancestor).isSymbolicLink(),'PRIVATE_REPARSE_POINT_FORBIDDEN');const parent=path.dirname(ancestor);need(parent!==ancestor,'PRIVATE_PATH_ANCESTOR_REQUIRED');ancestor=parent;}return absolute;
}
function publish(file,value){
 const absolute=privatePath(file);need(!existsSync(absolute),'IMMUTABLE_PROOF_ALREADY_EXISTS_STOP');const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');need(bytes.length<=RAW_CAP+64*1024,'PRIVATE_PROOF_SIZE_LIMIT');
 // Exclusive create never overwrites another proof; interrupted writes remain STOP-only.
 const fd=openSync(absolute,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}return {file:absolute,sha256:sha(bytes)};
}
function currentSources(){
 const sources={};for(const file of ['warehouse-units-staging-readonly.mjs','warehouse-units-staging-runner.mjs','warehouse-units-staging-readonly.test.mjs','crm-acceptance-transport.mjs'])sources[file]=sha(readFileSync(path.join(here,file)));
 sources['crm-modernization-staging.py']=sha(readFileSync(path.join(root,'deploy/acceptance/crm-modernization-staging.py')));return sources;
}
function approvedSql(){return verifiedMigrationChecksums([readFileSync(path.join(acceptanceWeb,'prisma/migrations',MIGRATION.name,'migration.sql'))]);}
export async function readonlyBundle(){
 const built=await build({entryPoints:[path.join(here,'warehouse-units-staging-readonly.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,logLevel:'silent'});const bytes=Buffer.from(built.outputFiles[0].contents);need(bytes.length>0&&bytes.length<=256*1024,'READONLY_BUNDLE_CAP');return bytes;
}
export function decodeReadonlySnapshot(body){
 need(body?.snapshotEncoding==='gzip-base64'&&typeof body.snapshot==='string'&&SHA64.test(body.snapshotSha256??''),'ENCODED_SNAPSHOT_REQUIRED');
 need(body.snapshot.length<=WIRE_CAP&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.snapshot),'COMPRESSED_WIRE_LIMIT');const compressed=Buffer.from(body.snapshot,'base64');need(compressed.toString('base64')===body.snapshot,'CANONICAL_BASE64_REQUIRED');
 let raw;try{raw=gunzipSync(compressed,{maxOutputLength:RAW_CAP});}catch{throw Error('BOUNDED_GZIP_INVALID');}need(raw.length<=RAW_CAP&&sha(raw)===body.snapshotSha256,'SNAPSHOT_DIGEST_MISMATCH');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw Error('SNAPSHOT_JSON_INVALID');}need(value&&typeof value==='object'&&!Array.isArray(value),'SNAPSHOT_OBJECT_REQUIRED');return value;
}
function verifiedResponse(result,input,bundleSha256){
 need(result?.body?.status==='READ_ONLY_CAPTURED'&&result.body.mode===input.mode&&result.body.runId===input.runId&&result.body.revision===input.revision,'CAPTURE_RESPONSE_BINDING_MISMATCH');
 const receipt=result.receipt;need(receipt?.identity?.hostname==='crm-staging'&&receipt.identity.revision===input.revision&&receipt.bundleSha256===bundleSha256&&receipt.operation==='inspect'&&receipt.exitCode===0,'LOCKED_STAGE_RECEIPT_REQUIRED');need(receipt.identity.databaseVolume==='crm-staging_pgdata'&&SHA64.test(receipt.identity.database??'')&&SHA64.test(receipt.identity.outerW07Sha256??''),'PHYSICAL_STAGE_RECEIPT_REQUIRED');return decodeReadonlySnapshot(result.body);
}
export async function runUnitStagingProof(options){
 validateOptions(options);privatePath(options.outputDir);mkdirSync(options.outputDir,{recursive:true});need(!existsSync(privatePath(path.join(options.outputDir,options.mode+'-proof.json'))),'IMMUTABLE_PROOF_ALREADY_EXISTS_STOP');
 const sources=currentSources(),expectedMigrations=approvedSql(),bytes=await readonlyBundle(),bundleSha256=bundleHash(bytes),input={operation:'inspect',mode:options.mode,authorized:true,revision:options.revision,runId:options.runId,expectedMigrations};
 let previous;if(options.mode==='after'){
  const beforePath=privatePath(options.beforeFile);need(statSync(beforePath).isFile()&&statSync(beforePath).size<=RAW_CAP+64*1024,'BOUNDED_PRIVATE_BEFORE_REQUIRED');const oldBytes=readFileSync(beforePath);need(sha(oldBytes)===options.beforeSha256,'EXACT_BEFORE_FILE_DIGEST_REQUIRED');previous=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(oldBytes));
  need(previous?.kind==='warehouse-units-staging-before'&&previous.version===1&&previous.runId===options.runId&&SHA40.test(previous.revision??'')&&previous.revision!==options.revision,'BEFORE_SCOPE_BINDING_MISMATCH');same(previous.sources,sources,'FROZEN_PROOF_SOURCES_CHANGED_STOP');same(previous.expectedMigrations,expectedMigrations,'FROZEN_SQL_CHECKSUMS_CHANGED_STOP');need(previous.bundleSha256===bundleSha256&&previous.identity?.hostname==='crm-staging'&&previous.identity.revision===previous.revision,'BEFORE_REVIEWED_BUNDLE_PROOF_REQUIRED');verifyBefore(previous.snapshot,{...input,mode:'before',revision:previous.revision});
 }
 // inspect сохраняет physical guard и workflow lock существующего strong wrapper.
 const transport=qaTransport({target:'staging',revision:options.revision,outputDir:options.outputDir});const result=await transport.execute(bytes,'inspect',input),snapshot=verifiedResponse(result,input,bundleSha256);same(currentSources(),sources,'CAPTURE_SOURCE_CHANGED_STOP');
 const verification=previous?verifyAfter(previous.snapshot,snapshot,{...input,beforeRevision:previous.revision}):verifyBefore(snapshot,input);
 if(previous){for(const field of ['database','databaseVolume','databaseStartedAt','outerW07Sha256'])same(result.receipt.identity[field],previous.identity[field],'PHYSICAL_DATABASE_PROOF_CHANGED_STOP');}
 const descriptor={kind:'warehouse-units-staging-'+options.mode,version:1,runId:options.runId,revision:options.revision,sources,expectedMigrations,bundleSha256,identity:result.receipt.identity,snapshot,verification,...(previous?{beforeSha256:options.beforeSha256,beforeRevision:previous.revision}:{})};const saved=publish(path.join(options.outputDir,options.mode+'-proof.json'),descriptor);
 return {status:previous?'AFTER_VERIFIED':'BEFORE_CAPTURED',mode:options.mode,runId:options.runId,revision:options.revision,...saved,verification,dbReadOnly:true,fixturesCreated:false,migrationExecuted:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);try{
  if(mode==='build'){
   need(args.length===1&&path.isAbsolute(args[0]),'EXPLICIT_PRIVATE_BUILD_OUTPUT_REQUIRED');approvedSql();const bytes=await readonlyBundle(),out=privatePath(args[0]);mkdirSync(path.dirname(out),{recursive:true});const fd=openSync(out,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}console.log(JSON.stringify({status:'BUILT',out,size:bytes.length,sha256:bundleHash(bytes),stageExecuted:false,dbExecuted:false}));
  }else{
   const [revision,runId,outputDir,...flags]=args;let beforeFile,beforeSha256;
   if(mode==='before')need(flags.length===1&&flags[0]==='--authorized','EXPLICIT_ROOT_REVIEW_REQUIRED');else{need(mode==='after'&&flags.length===5&&flags[0]==='--before'&&flags[2]==='--before-sha256'&&flags[4]==='--authorized','HASHED_BEFORE_REVIEW_REQUIRED');beforeFile=flags[1];beforeSha256=flags[3];}
   console.log(JSON.stringify(await runUnitStagingProof({mode,revision,runId,outputDir,beforeFile,beforeSha256,authorized:true})));
  }
 }catch(error){const code=/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'TASK110_READONLY_COORDINATOR_STOP';console.log(JSON.stringify({status:'STOP',code,mode,stageMutationExecuted:false}));process.exitCode=1;}
}
