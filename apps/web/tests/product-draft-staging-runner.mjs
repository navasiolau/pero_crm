// Root-only readonly proof111: build/import never contacts staging or a database.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {qaTransport,bundleHash,acceptanceWeb} from './crm-acceptance-transport.mjs';
import {canonical,verifyBefore,verifyAfter} from './product-draft-staging-readonly.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(acceptanceWeb,'../..'),results=path.join(acceptanceWeb,'test-results');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const APPROVED_MIGRATIONS=[
 {name:'20261008111000_product_draft_enum',checksum:'aa26a2d37c3a10a84a36ddbbe0b2c812e37e681ad6aebf5bef92167aec464fdf'},
 {name:'20261008111100_product_draft_backfill',checksum:'fd64535e420f10196a670c5cec76d8abe37b915b8cb3a7a57dcc4ccf8824f1e2'},
];
const need=(ok,code)=>{if(!ok)throw Error(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function same(a,b,code){need(canonical(a)===canonical(b),code);}
export function verifiedMigrationChecksums(contents){
 need(Array.isArray(contents)&&contents.length===2,'EXACT_TWO_MIGRATION_FILES_REQUIRED');
 const found=contents.map((content,index)=>({name:APPROVED_MIGRATIONS[index].name,checksum:sha(Buffer.from(content).toString('utf8').replaceAll('\r\n','\n'))}));
 same(found,APPROVED_MIGRATIONS,'APPROVED_MIGRATION_SQL_CHANGED_STOP');
 return found;
}
export function validateOptions(options){
 need(options&&Object.keys(options).every(key=>['mode','authorized','revision','runId','outputDir','beforeFile','beforeSha256'].includes(key)),'RUNNER_OPTIONS_CANONICAL_FIELDS_REQUIRED');
 need(options?.authorized===true&&['before','after'].includes(options.mode)&&SHA40.test(options.revision??'')&&UUID.test(options.runId??''),'AUTHORIZED_EXACT_STAGE_REVISION_REQUIRED');
 need(path.isAbsolute(options.outputDir??''),'PRIVATE_ABSOLUTE_OUTPUT_REQUIRED');
 if(options.mode==='before')need(options.beforeFile===undefined&&options.beforeSha256===undefined,'BEFORE_HAS_NO_PRIOR_INPUT');
 else need(path.isAbsolute(options.beforeFile??'')&&SHA64.test(options.beforeSha256??''),'AFTER_HASHED_BEFORE_REQUIRED');
 return options;
}
function privatePath(file){
 const absolute=path.resolve(file),relative=path.relative(results,absolute);
 need(relative.length>0&&!relative.startsWith('..')&&!path.isAbsolute(relative),'PRIVATE_TEST_RESULTS_PATH_REQUIRED');
 need(existsSync(results)&&realpathSync(results).toLowerCase()===results.toLowerCase(),'PRIVATE_RESULTS_ROOT_REQUIRED');
 let ancestor=absolute;
 while(ancestor.toLowerCase()!==results.toLowerCase()){
  if(existsSync(ancestor))need(!lstatSync(ancestor).isSymbolicLink(),'PRIVATE_REPARSE_POINT_FORBIDDEN');
  const parent=path.dirname(ancestor);need(parent!==ancestor,'PRIVATE_PATH_ANCESTOR');ancestor=parent;
 }
 return absolute;
}
function publish(file,value){
 const absolute=privatePath(file),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 need(!existsSync(absolute),'IMMUTABLE_PROOF_ALREADY_EXISTS_STOP');
 const temporary=privatePath(path.join(path.dirname(absolute),'.writing-'+randomUUID()));
 const fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,absolute);
 return {file:absolute,sha256:sha(bytes)};
}
function currentSources(){
 const sources={};
 for(const name of ['product-draft-staging-readonly.mjs','product-draft-staging-runner.mjs','crm-acceptance-transport.mjs'])sources[name]=sha(readFileSync(path.join(here,name)));
 sources['crm-modernization-staging.py']=sha(readFileSync(path.join(root,'deploy/acceptance/crm-modernization-staging.py')));
 return sources;
}
function approvedSql(){return verifiedMigrationChecksums(APPROVED_MIGRATIONS.map(row=>readFileSync(path.join(acceptanceWeb,'prisma/migrations',row.name,'migration.sql'))));}
export async function draftStagingBundle(){
 const result=await build({entryPoints:[path.join(here,'product-draft-staging-readonly.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,logLevel:'silent'});
 const bytes=Buffer.from(result.outputFiles[0].contents);
 need(bytes.length>0&&bytes.length<=256*1024,'READONLY_BUNDLE_SIZE_LIMIT');
 return bytes;
}
export function decodeReadonlySnapshot(body){
 if(body?.snapshotEncoding===undefined){
  need(body?.snapshot!==null&&typeof body.snapshot==='object'&&!Array.isArray(body.snapshot),'READONLY_SNAPSHOT_OBJECT_REQUIRED');
  return body.snapshot;
 }
 need(body.snapshotEncoding==='gzip-base64'&&typeof body.snapshot==='string'&&SHA64.test(body.snapshotSha256??''),'READONLY_SNAPSHOT_ENCODING_REQUIRED');
 need(body.snapshot.length<=256*1024&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.snapshot),'READONLY_COMPRESSED_WIRE_LIMIT');
 let bytes;
 try{bytes=gunzipSync(Buffer.from(body.snapshot,'base64'),{maxOutputLength:8*1024*1024});}catch{throw Error('READONLY_COMPRESSED_SNAPSHOT_INVALID');}
 need(sha(bytes)===body.snapshotSha256,'READONLY_SNAPSHOT_CHECKSUM_MISMATCH');
 let snapshot;try{snapshot=JSON.parse(bytes.toString('utf8'));}catch{throw Error('READONLY_SNAPSHOT_JSON_INVALID');}
 need(snapshot!==null&&typeof snapshot==='object'&&!Array.isArray(snapshot),'READONLY_SNAPSHOT_OBJECT_REQUIRED');
 return snapshot;
}
function verifiedResponse(result,input,expectedBundleSha){
 need(result?.body?.status==='READ_ONLY_CAPTURED'&&result.body.mode===input.mode&&result.body.runId===input.runId&&result.body.revision===input.revision,'READONLY_CAPTURE_RESPONSE_MISMATCH');
 need(result.receipt?.identity?.hostname==='crm-staging'&&result.receipt.identity.revision===input.revision&&result.receipt.bundleSha256===expectedBundleSha,'LOCKED_STAGE_RECEIPT_MISMATCH');
 need(result.receipt.identity.databaseVolume==='crm-staging_pgdata'&&SHA64.test(result.receipt.identity.outerW07Sha256??''),'PHYSICAL_STAGE_RECEIPT_REQUIRED');
 return decodeReadonlySnapshot(result.body);
}
export async function runDraftStagingProof(options){
 validateOptions(options);
 privatePath(options.outputDir);mkdirSync(options.outputDir,{recursive:true});
 need(!existsSync(privatePath(path.join(options.outputDir,options.mode+'-proof.json'))),'IMMUTABLE_PROOF_ALREADY_EXISTS_STOP');
 const sources=currentSources(),expectedMigrations=approvedSql(),bytes=await draftStagingBundle(),bundleSha256=bundleHash(bytes);
 const input={operation:'inspect',mode:options.mode,authorized:true,revision:options.revision,runId:options.runId,expectedMigrations};
 let previous;
 if(options.mode==='after'){
  const beforeBytes=readFileSync(privatePath(options.beforeFile));need(sha(beforeBytes)===options.beforeSha256,'EXACT_BEFORE_DIGEST_MISMATCH');
  previous=JSON.parse(beforeBytes.toString('utf8'));
  need(previous?.kind==='product-draft-staging-before'&&previous.version===1&&previous.runId===options.runId&&SHA40.test(previous.revision??''),'BEFORE_PROOF_BINDING_MISMATCH');
  need(previous.revision!==options.revision,'BEFORE_AFTER_REVISIONS_MUST_DIFFER');
  same(previous.sources,sources,'BEFORE_SOURCE_HASHES_CHANGED_STOP');
  same(previous.expectedMigrations,expectedMigrations,'BEFORE_MIGRATION_CHECKSUMS_CHANGED_STOP');
  need(previous.bundleSha256===bundleSha256&&previous.identity?.hostname==='crm-staging'&&previous.identity.revision===previous.revision,'BEFORE_REVIEWED_BUNDLE_IDENTITY_MISMATCH');
  verifyBefore(previous.snapshot,{...input,mode:'before',revision:previous.revision});
 }
 // Existing wrapper supplies the physical proof/lock only for inspect.
 // This bundle itself performs SET READ ONLY and SELECT; no fixture or migration.
 const transport=qaTransport({target:'staging',revision:options.revision,outputDir:options.outputDir});
 const result=await transport.execute(bytes,'inspect',input),snapshot=verifiedResponse(result,input,bundleSha256);
 same(currentSources(),sources,'CAPTURE_SOURCE_CHANGED_STOP');
 const verification=options.mode==='before'?verifyBefore(snapshot,input):verifyAfter(previous.snapshot,snapshot,{...input,beforeRevision:previous.revision});
 if(previous){
  same(result.receipt.identity.database,previous.identity.database,'PHYSICAL_DATABASE_CONTAINER_CHANGED_STOP');
  same(result.receipt.identity.databaseVolume,previous.identity.databaseVolume,'PHYSICAL_DATABASE_VOLUME_CHANGED_STOP');
  same(result.receipt.identity.outerW07Sha256,previous.identity.outerW07Sha256,'OUTER_W07_PROOF_CHANGED_STOP');
 }
 const descriptor={kind:'product-draft-staging-'+options.mode,version:1,runId:options.runId,revision:options.revision,sources,expectedMigrations,bundleSha256,identity:result.receipt.identity,snapshot,verification,...(previous?{beforeSha256:options.beforeSha256,beforeRevision:previous.revision}:{})};
 const saved=publish(path.join(options.outputDir,options.mode+'-proof.json'),descriptor);
 return {status:options.mode==='before'?'BEFORE_CAPTURED':'AFTER_VERIFIED',mode:options.mode,runId:options.runId,revision:options.revision,...saved,verification,dbReadOnly:true,fixturesCreated:false,migrationExecuted:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 try{
  if(mode==='build'){
   need(args.length===1&&path.isAbsolute(args[0]),'EXPLICIT_PRIVATE_BUNDLE_OUTPUT_REQUIRED');
   approvedSql();const bytes=await draftStagingBundle(),out=privatePath(args[0]);mkdirSync(path.dirname(out),{recursive:true});
   const fd=openSync(out,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
   console.log(JSON.stringify({status:'BUILT',out,size:bytes.length,sha256:bundleHash(bytes),stageExecuted:false,dbExecuted:false}));
  }else{
   const [revision,runId,outputDir,...flags]=args;
   let beforeFile,beforeSha256;
   if(mode==='before')need(flags.length===1&&flags[0]==='--authorized','EXPLICIT_ROOT_REVIEW_REQUIRED');
   else{need(mode==='after'&&flags.length===5&&flags[0]==='--before'&&flags[2]==='--before-sha256'&&flags[4]==='--authorized','EXPLICIT_HASHED_BEFORE_REVIEW_REQUIRED');beforeFile=flags[1];beforeSha256=flags[3];}
   console.log(JSON.stringify(await runDraftStagingProof({mode,revision,runId,outputDir,beforeFile,beforeSha256,authorized:true})));
  }
 }catch(error){console.log(JSON.stringify({status:'STOP',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'TASK111_READONLY_PROOF_STOP',mode,stageMutationExecuted:false}));process.exitCode=1;}
}
