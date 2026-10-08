import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac} from 'node:crypto';
import {stageGuard,ownStorageKey,verifySigned} from './engineer-sketch-qa-entry.mjs';
import {runSketchQa,sketchQaBundle} from './engineer-sketch-stage-runner.mjs';
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
test('112 reviewed bundle builds offline with real external Prisma/Auth/S3 packages and no execution',async()=>{
 const bytes=await sketchQaBundle();assert.ok(bytes.length>1000&&bytes.length<=256*1024);const code=bytes.toString('utf8');assert.match(code,/@prisma\/client/);assert.match(code,/@aws-sdk\/client-s3/);assert.match(code,/http:\/\/127\.0\.0\.1:3000/);assert.doesNotMatch(code,/pg_dump|restic|pct stop|systemctl/);
});
