// Узкий transport carrier: одна полная signed observation, две ссылки только в памяти.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP mismatch. Нет runtime на import/build.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {need,canonical,digest,sha} from './file-fixture113-protocol.mjs';
const CORE_PINS=Object.freeze({'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb','file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92','crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51'});
const AUTORUN="const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();";
const here=path.dirname(fileURLToPath(import.meta.url));
function cleanupAliasScope(input){
 need(input?.authorized===true&&input.operation==='restore'&&input.mode==='cleanup'&&/^[a-f0-9]{40}$/.test(input.revision??'')&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.runId??''),'EXACT_RESTORE_CLEANUP_SCOPE_REQUIRED');
 need(input.pre?.runId===input.runId&&input.pre.revision===input.revision&&canonical(input.pre.sources)===canonical(CORE_PINS)&&input.preSha256===digest(input.pre),'IMMUTABLE_PARENT_PRE_REQUIRED');
 for(const[value,kind]of [[input.pre,'pre'],[input.observation,'observation'],[input.cleanupIntent,'cleanup-intent']])need(value?.namespace==='PERO_FILE_ACCEPTANCE_113_V2'&&value.version===2&&value.kind===kind&&value.runId===input.runId&&value.revision===input.revision&&/^[a-f0-9]{64}$/.test(value.signature??''),'SAME_SIGNED_CLEANUP_SUBJECT_REQUIRED');
 need(input.observation.preSha256===input.preSha256&&input.cleanupIntent.preSha256===input.preSha256&&input.cleanupIntent.observationSha256===digest(input.observation)&&input.cleanupIntentSha256===digest(input.cleanupIntent),'PAIRED_FULL_SIGNED_CLEANUP_REQUIRED');return true;
}
export function cleanupAliasMetrics(value){
 const text=JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')),bytes=Buffer.byteLength(text);return {decodedBytes:bytes,encodedBytes:Math.ceil(bytes/3)*4};
}
export function compactCleanupAliasInput(input){
 cleanupAliasScope(input);need(!Object.hasOwn(input,'cleanupAlias')&&canonical(input.priorObservation)===canonical(input.observation),'ONLY_REDUNDANT_IDENTICAL_OBSERVATION_ALIAS');
 const {priorObservation,...base}=input,binding={kind:'cleanup-observation-alias-v1',runId:input.runId,revision:input.revision,preSha256:input.preSha256,observationSha256:digest(input.observation),cleanupIntentSha256:input.cleanupIntentSha256,originalFullInputHash:digest(input),baseWireHash:digest(base),sourcePins:{...CORE_PINS}};
 const wire={...base,cleanupAlias:binding};need(cleanupAliasMetrics(wire).encodedBytes<=96*1024,'EXISTING_ALIAS_WIRE_CAP');return {wire,binding,originalMetrics:cleanupAliasMetrics(input),compactMetrics:cleanupAliasMetrics(wire)};
}
export function restoreCleanupAliasInput(wire,expected){
 need(wire&&typeof wire==='object'&&!Object.hasOwn(wire,'priorObservation')&&canonical(wire.cleanupAlias)===canonical(expected)&&expected?.kind==='cleanup-observation-alias-v1'&&canonical(expected.sourcePins)===canonical(CORE_PINS),'EXACT_COMPILED_ALIAS_BINDING_REQUIRED');
 need(cleanupAliasMetrics(wire).encodedBytes<=96*1024,'EXISTING_ALIAS_WIRE_CAP');const {cleanupAlias,...base}=wire;
 need(digest(base)===expected.baseWireHash&&base.runId===expected.runId&&base.revision===expected.revision&&base.preSha256===expected.preSha256&&digest(base.observation)===expected.observationSha256&&base.cleanupIntentSha256===expected.cleanupIntentSha256,'COMPACT_ALIAS_SEMANTICS_CHANGED');
 const full={...base,priorObservation:base.observation};cleanupAliasScope(full);need(digest(full)===expected.originalFullInputHash,'ORIGINAL_FULL_INPUT_HASH_CHANGED');return full;
}
export function checkedCleanupAliasSources(read=name=>readFileSync(path.join(here,name))){
 const bytes={};for(const[name,pin]of Object.entries(CORE_PINS)){bytes[name]=read(name);need(bytes[name] instanceof Uint8Array&&sha(bytes[name])===pin,'IMMUTABLE_BACKEND_SOURCE_BYTES_CHANGED');}return bytes;
}
export async function cleanupAliasBundle(input){
 const original=checkedCleanupAliasSources(),compact=compactCleanupAliasInput(input),text=Buffer.from(original['file-fixture113-entry.mjs']).toString('utf8'),parts=text.split(AUTORUN);need(parts.length===2&&/^\r?\n?$/.test(parts[1]),'EXACT_ONE_FINAL_AUTORUN_REQUIRED');
 const wrapper=`
 const CORE_PINS=${JSON.stringify(CORE_PINS)};
 ${cleanupAliasScope.toString()}
 ${cleanupAliasMetrics.toString()}
 ${restoreCleanupAliasInput.toString()}
 const TASK113_ALIAS_EXPECTED=${JSON.stringify(compact.binding)};
 async function cleanupAliasMain(){let db,s3,result;try{
  const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'BOUNDED_PRIVATE_INPUT');
  const wire=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),input=restoreCleanupAliasInput(wire,TASK113_ALIAS_EXPECTED),guard=fixtureStageGuard(input,process.env,{host:hostname(),docker:existsSync('/.dockerenv')});
  preGuard(input.pre,guard.secret,input);db=new PrismaClient({log:[],errorFormat:'minimal'});s3=client();
  const ack=await cleanup(db,s3,input.pre,input,guard.secret);result={status:'OWN_CLEANED',ack};need(Buffer.byteLength(JSON.stringify(result))<=64*1024,'PRIVATE_OUTPUT_CAP');
 }catch(error){result={status:'STOP',phase:'cleanup',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'CLEANUP_ALIAS_STOP_PRESERVE_STATE'};process.exitCode=1;}finally{await db?.$disconnect();s3?.destroy();}console.log(JSON.stringify(result));}
 if(process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void cleanupAliasMain();
 `;
 const source=parts[0]+wrapper,require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
 const pack=await build({entryPoints:['task113:cleanup-alias-entry'],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3','sharp'],banner:{js:'import {createRequire as task113AliasRequire} from "node:module"; const require=task113AliasRequire(import.meta.url);'},define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(CORE_PINS)},plugins:[{name:'exact-frozen-cleanup-carrier',setup(b){b.onResolve({filter:/^task113:cleanup-alias-entry$/},()=>({path:'cleanup-alias-entry',namespace:'task113-cleanup-alias'}));b.onLoad({filter:/.*/,namespace:'task113-cleanup-alias'},()=>({contents:source,loader:'js',resolveDir:here}));}}],minify:true,logLevel:'silent'});
 const bytes=Buffer.from(pack.outputFiles[0].contents);need(bytes.length>0&&bytes.length<=256*1024,'EXISTING_ALIAS_BUNDLE_CAP');return {bytes,sha256:sha(bytes),input:compact.wire,binding:compact.binding,originalMetrics:compact.originalMetrics,compactMetrics:compact.compactMetrics,sourcePins:{...CORE_PINS},sourceSha256:sha(readFileSync(fileURLToPath(import.meta.url)))};
}