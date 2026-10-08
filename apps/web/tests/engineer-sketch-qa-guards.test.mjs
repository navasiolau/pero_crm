import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac} from 'node:crypto';
import {stageGuard,ownStorageKey,verifySigned,validatePartialRecovery,originalExceptOrgSettingMatches,describeOrgSettingEvidence,verifyOperationalClockEvidence,readOriginalReadOnly,validateOwnedBrowserState} from './engineer-sketch-qa-entry.mjs';
import {runSketchQa,sketchQaBundle,requestSketchBrowserHandoff} from './engineer-sketch-stage-runner.mjs';
import {qaProcess} from './crm-acceptance-transport.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const runId='11211211-2112-4112-8112-112112112112',revision='a'.repeat(40),web='b'.repeat(64);
const input={authorized:true,runId,revision};
const env={CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://qa:private@db:5432/crm?schema=public',CRM_FILE_STORAGE:'s3',S3_ENDPOINT:'http://192.168.0.33:9000',S3_BUCKET:'pero-crm-staging',S3_ACCESS_KEY:'private',S3_SECRET_KEY:'private',AUTH_SECRET:'private',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({hostname:'crm-staging',revision,web,database:'c'.repeat(64),databaseVolume:'crm-staging_pgdata',outerW07Sha256:'d'.repeat(64)})};
const container={host:web.slice(0,12),docker:true};
test('112 staging guard accepts reviewed exact binding and rejects prod/local/revision/host/options/secret drift before IO',()=>{
 assert.equal(stageGuard(input,env,container).proof.revision,revision);
 for(const patch of [{CRM_MODERNIZATION_TARGET:'production'},{DATABASE_URL:'postgresql://qa:private@localhost:5433/pero_crm'},{S3_BUCKET:'pero-crm'},{S3_ENDPOINT:'http://192.168.0.35:9000'},{CRM_FILE_STORAGE:'local'},{DATABASE_URL:env.DATABASE_URL+'&options=unsafe'},{DATABASE_URL:env.DATABASE_URL+'&schema=other'},{AUTH_SECRET:''}])assert.throws(()=>stageGuard(input,{...env,...patch},container));
 assert.throws(()=>stageGuard({...input,authorized:false},env,container));assert.throws(()=>stageGuard({...input,revision:'e'.repeat(40)},env,container));assert.throws(()=>stageGuard(input,env,{...container,host:'f'.repeat(12)}));assert.throws(()=>stageGuard(input,env,{...container,docker:false}));
});
test('112 cleanup storage guard allows only owned UUID originals/thumbs and run names',()=>{
 const cp={runId,ids:{project:runId}},name=`${runId}-qa112-${runId}-initial.png`;
 assert.equal(ownStorageKey(cp,`${runId}/${name}`),true);assert.equal(ownStorageKey(cp,`${runId}/thumbs/${name}.jpg`),true);
 for(const key of [`foreign/${name}`,`${runId}/../${name}`,`${runId}/thumbs/../${name}.jpg`,`${runId}/old.png`,`${runId}/${runId}-qa112-foreign-initial.png`,`${runId}/${runId}-qa112-${runId}-initial.pdf`])assert.equal(ownStorageKey(cp,key),false);
});
test('112 signed scope rejects caller-fabricated or changed ownership before a database client',()=>{
 const value={namespace:'PERO_ENGINEER_SKETCH_QA_112_V1',kind:'checkpoint',runId,revision,ids:{project:runId}};
 const stable=item=>item&&typeof item==='object'?`{${Object.keys(item).sort().map(key=>`${JSON.stringify(key)}:${stable(item[key])}`).join(',')}}`:JSON.stringify(item);
 const signature=createHmac('sha256','private').update(value.namespace+'\0'+stable(value)).digest('hex');
 assert.equal(verifySigned({...value,signature},'private','checkpoint',input).ids.project,runId);
 assert.throws(()=>verifySigned({...value,signature,ids:{project:'foreign'}},'private','checkpoint',input));assert.throws(()=>verifySigned({...value,signature},'wrong','checkpoint',input));
});
test('112 coordinator requires explicit root authorization before filesystem or transport',async()=>{
 await assert.rejects(runSketchQa({operation:'prepare',revision,runId,outputDir:'C:/unused',authorized:false}),/AUTHORIZED_EXPLICIT_SCOPE_REQUIRED/);
});
test('112 reviewed bundle builds offline with external Prisma/S3 and internally bundled Auth JWT, without execution',async()=>{
 const bytes=await sketchQaBundle();assert.ok(bytes.length>1000&&bytes.length<=256*1024);const code=bytes.toString('utf8');assert.doesNotMatch(code,/(?:from\s*|import\()\s*['" ]@auth\/core\/jwt['"]/);assert.match(code,/@prisma\/client/);assert.match(code,/@aws-sdk\/client-s3/);assert.match(code,/http:\/\/127\.0\.0\.1:3000/);assert.doesNotMatch(code,/pg_dump|restic|pct stop|systemctl/);
});
test('112 bundled JWT roundtrip loads before any DB/S3 main under the exact standalone ESM entry shape',async()=>{
 const folder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../test-results');await mkdir(folder,{recursive:true});
 const file=path.join(folder,'engineer-sketch-module-preflight-test.mjs');await writeFile(file,await sketchQaBundle());
 const result=await qaProcess(process.execPath,[file],{env:{...process.env,CRM_TASK112_DEPENDENCY_PROBE:'1',CRM_STAGING_BROWSER_INPUT:'NOT_A_MUTATION_INPUT'}});
 assert.equal(result.code,0);assert.deepEqual(JSON.parse(result.stdout),{status:'QA_BUNDLE_PREFLIGHT_PASS',cryptoRoundTrip:true,dbInstantiated:false,s3Instantiated:false});
});
test('112 partial recovery requires explicit exact AE run, current OrgSetting fingerprint and both known files',()=>{
 const cp={runId:'ae9ce4bb-b574-400b-8fff-30c22f9eec58'},policy={acknowledgement:'PRESERVE_CURRENT_ORGSETTING_UNKNOWN_PRIOR_VALUE',expectedOrgSetting:{count:'2',hash:'c77deabc7bc7948537c8828ec8bb4dac'},ownFileIds:['cmuzv9uu50001o201hnax4t82','cmuzv9vaz000do201ppwk4pht']};
 assert.equal(validatePartialRecovery(cp,policy),policy);
 for(const altered of [{...policy,acknowledgement:'IGNORE_ORGSETTING'},{...policy,expectedOrgSetting:{count:'3',hash:policy.expectedOrgSetting.hash}},{...policy,ownFileIds:['foreign']},{...policy,ignore:true}])assert.throws(()=>validatePartialRecovery(cp,altered));
 assert.throws(()=>validatePartialRecovery({runId:'845349e1-8dba-4193-b2a2-aca9e570be96'},policy));
});
test('112 partial comparison preserves strict schema and every non-OrgSetting row fingerprint',()=>{
 const baseline={schema:'unchanged',rows:{OrgSetting:{count:'2',hash:'before'},Product:{count:'1',hash:'product'},User:{count:'3',hash:'users'}}},current={schema:'unchanged',rows:{...baseline.rows,OrgSetting:{count:'2',hash:'acknowledged-current'}}};
 assert.equal(originalExceptOrgSettingMatches(current,baseline),true);
 assert.equal(originalExceptOrgSettingMatches({...current,schema:'changed'},baseline),false);
 assert.equal(originalExceptOrgSettingMatches({...current,rows:{...current.rows,Product:{count:'1',hash:'changed-price'}}},baseline),false);
 assert.equal(originalExceptOrgSettingMatches({...current,rows:{...current.rows,Unexpected:{count:'1',hash:'new'}}},baseline),false);
});
test('112 partial cleanup source writes only an explicit owned-table allowlist and never OrgSetting',async()=>{
 const code=await readFile(new URL('../tests/engineer-sketch-qa-entry.mjs',import.meta.url),'utf8');
 assert.equal(/\.orgSetting\.(?:create|update|upsert|delete|deleteMany|updateMany)\(/.test(code),false);
 assert.match(code,/FOR UPDATE/);assert.match(code,/PARTIAL_STATE_CAS_CHANGED/);assert.match(code,/priorValueKnown:false/);assert.match(code,/fullOriginalMatch:false/);
});
test('112 fresh signed BEFORE evidence tolerates only telegram metadata clock, never value/otherfields/count/otherrows',()=>{
 const initial=[{key:'productPercentageDefaults',value:'dummy_defaults',updatedAt:'2026-10-08T18:00:00Z'},{key:'telegram.botUsername',value:'dummy_bot',updatedAt:'2026-10-08T18:00:00Z'}],before=describeOrgSettingEvidence(initial);
 assert.deepEqual(verifyOperationalClockEvidence(before,describeOrgSettingEvidence(initial)),{valid:true,changed:false});
 const changed=(key,patch)=>initial.map(row=>row.key===key?{...row,...patch}:row);
 assert.deepEqual(verifyOperationalClockEvidence(before,describeOrgSettingEvidence(changed('telegram.botUsername',{updatedAt:'2026-10-08T19:00:00Z'}))),{valid:true,changed:true});
 for(const rows of [changed('telegram.botUsername',{value:'other_bot'}),changed('telegram.botUsername',{unexpectedField:'changed'}),changed('telegram.botUsername',{updatedAt:'2026-10-08T17:00:00Z'}),changed('productPercentageDefaults',{value:'other_defaults'}),changed('productPercentageDefaults',{updatedAt:'2026-10-08T19:00:00Z'}),[...initial,{key:'other',value:'new',updatedAt:'2026-10-08T18:00:00Z'}],initial.slice(0,1)])assert.equal(verifyOperationalClockEvidence(before,describeOrgSettingEvidence(rows)).valid,false);
 assert.equal(verifyOperationalClockEvidence(undefined,before).valid,false);
});
test('112 absent pre-existing bot metadata cannot authorize creating a new username under timestamp allowance',()=>{
 const absent=describeOrgSettingEvidence([]);assert.equal(verifyOperationalClockEvidence(absent,absent).valid,true);
 const created=describeOrgSettingEvidence([{key:'telegram.botUsername',value:'dummy_bot',updatedAt:'2026-10-08T18:00:00Z'}]);assert.equal(verifyOperationalClockEvidence(absent,created).valid,false);
});
function interleavedSnapshotFixture(currentRows,externalRows){
 let live=structuredClone(currentRows);const calls=[];
 const fingerprint=rows=>({schema:'same-schema',rows:{OrgSetting:{count:String(rows.length),hash:JSON.stringify(rows)},Product:{count:'1',hash:'unchanged'}}});
 const client={orgSetting:{findMany:async()=>structuredClone(live)},$transaction:async(operation,options)=>{calls.push(options);const frozen=structuredClone(live),tx={orgSetting:{findMany:async()=>structuredClone(frozen)},$executeRawUnsafe:async command=>{calls.push(command);return 0},$queryRaw:async()=>[{name:'crm',schema:'public'}]};return operation(tx);}};
 const read=async db=>{const observed=await db.orgSetting.findMany(),result=fingerprint(observed);live=structuredClone(externalRows);return result;};
 return {client,read,calls,fingerprint};
}
test('112 one readonly snapshot cannot label MATCH with a later bot clock from a different database version',async()=>{
 const beforeRows=[{key:'telegram.botUsername',value:'dummy_bot',updatedAt:'2026-10-08T18:00:00Z'}],afterRows=[{...beforeRows[0],updatedAt:'2026-10-08T19:00:00Z'}],f=interleavedSnapshotFixture(beforeRows,afterRows),cp={baseline:f.fingerprint(beforeRows),operationalOrgSettingBefore:describeOrgSettingEvidence(beforeRows)};
 const result=await readOriginalReadOnly(f.client,cp,f.read);
 assert.equal(result.originalDatabase,'MATCH');assert.equal(result.operationalOrgSettingCurrent.bot.updatedAt,cp.operationalOrgSettingBefore.bot.updatedAt);
 assert.equal(f.calls[0]?.isolationLevel,'RepeatableRead');assert.ok(f.calls.includes('SET TRANSACTION READ ONLY'));
});
test('112 a value change present at snapshot cannot become a fake clock-only PASS after an outside revert',async()=>{
 const beforeRows=[{key:'telegram.botUsername',value:'dummy_bot',updatedAt:'2026-10-08T18:00:00Z'}],changed=[{...beforeRows[0],value:'changed_bot',updatedAt:'2026-10-08T19:00:00Z'}],reverted=[{...beforeRows[0],updatedAt:'2026-10-08T19:00:00Z'}],f=interleavedSnapshotFixture(changed,reverted),cp={baseline:f.fingerprint(beforeRows),operationalOrgSettingBefore:describeOrgSettingEvidence(beforeRows)};
 await assert.rejects(readOriginalReadOnly(f.client,cp,f.read),/OPERATIONAL_ORGSETTING_FIELDS_CHANGED/);
});
test('112 readonly browser handoff derives exact own paths/current sketch and nullable own project cover',()=>{
 const cp={runId,revision,ids:{project:'own-project',product:'own-product'},number:'216',productNumber:'216.1',actors:{manager:{id:'own-manager',roles:['MANAGER'],sessionVersion:0}}},manager={...cp.actors.manager,active:true},project={id:cp.ids.project,number:cp.number,title:`QA112 ${runId}`,deletedAt:null,coverFileId:null},product={id:cp.ids.product,projectId:project.id,number:cp.productNumber,title:project.title,deletedAt:null,sketchFileId:'own-sketch'},sketch={id:'own-sketch',projectId:project.id,productId:product.id,taskId:null,fileName:`qa112-${runId}-final.png`,storedName:`${runId}-qa112-${runId}-final.png`,mimeType:'image/png',hasThumb:true};
 const binding=validateOwnedBrowserState(cp,manager,project,product,sketch,null);
 assert.equal(binding.origin,'https://staging-crm.peromebel.by');assert.deepEqual(binding.ownedPaths,{project:'/projects/own-project',product:'/products/216.1'});assert.equal(binding.currentSketchFileId,'own-sketch');assert.equal(binding.currentProjectCoverFileId,null);
 for(const changed of [{...manager,id:'foreign'},{...manager,roles:['ADMIN']},{...manager,active:false},{...manager,sessionVersion:1}])assert.throws(()=>validateOwnedBrowserState(cp,changed,project,product,sketch,null));
 assert.throws(()=>validateOwnedBrowserState(cp,manager,project,{...product,projectId:'foreign'},sketch,null));assert.throws(()=>validateOwnedBrowserState(cp,manager,project,product,{...sketch,fileName:'real-client.png'},null));assert.throws(()=>validateOwnedBrowserState(cp,manager,{...project,coverFileId:'foreign'},product,sketch,{id:'foreign',projectId:'outside',fileName:'real.png',mimeType:'image/png'}));
});
test('112 handoff request has no unauthorized transport, caller URL or actor override',async()=>{
 await assert.rejects(requestSketchBrowserHandoff({revision,checkpoint:{revision},outputDir:'C:/unused',authorized:false}),/HANDOFF_AUTHORIZED_BINDING_REQUIRED/);
});
