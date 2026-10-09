// Один offline контроль: живой coordinator/transport, synthetic signed data, все SSH spawn подменены.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP mismatch, frozen backend3/PRE не меняются.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {fixture113Bundle,fixture113Coordinator,producerSources} from './file-fixture113-runner.mjs';
import {newFixturePlan,signed,digest,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('delete ACK omits only ignored outer prior and preserves signed intent deleted IDs/keys with original backend bundle',async()=>{
 const pack=await fixture113Bundle();assert.equal(pack.sha256,'478fed01184f5ad779c4c60aa3a2654ffd96c194f545650f6917bcf65ee54bde');
 assert.deepEqual(producerSources(),{'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb','file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92','crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51'});
 const runId=randomUUID(),revision='b'.repeat(40),secret='SYNTHETIC_TEST_ONLY',plan=newFixturePlan(runId,revision),pre=signed({namespace:FIXTURE_NAMESPACE,version:2,kind:'pre',runId,revision,plan,sources:pack.sources},secret);
 const oldId=randomUUID(),deletedId=randomUUID(),keys=[plan.ids.project+'/old-key',plan.ids.project+'/deleted-key'];
 const before=signed({namespace:FIXTURE_NAMESPACE,version:2,kind:'observation',runId,revision,preSha256:digest(pre),scope:{File:[oldId,deletedId]},keys,rows:{File:[{id:oldId},{id:deletedId}]},padding:'x'.repeat(36*1024)},secret);
 const intent=signed({namespace:FIXTURE_NAMESPACE,version:2,kind:'delete-intent',runId,revision,preSha256:digest(pre),fileId:deletedId,actorId:plan.actors.engineer.id,observation:before},secret);
 const after=signed({...before,rows:{File:[{id:oldId}]},signature:undefined},secret),ack=signed({namespace:FIXTURE_NAMESPACE,version:2,kind:'delete-ack',runId,revision,preSha256:digest(pre),intentSha256:digest(intent),observation:after,verification:{deleted:true}},secret);
 const dir=mkdtempSync(fileURLToPath(new URL('../test-results/delete-ack-control-',import.meta.url))),preFile=path.join(dir,'0001-pre.json'),obsFile=path.join(dir,'0002-observation.json');
 writeFileSync(preFile,JSON.stringify({kind:'private-pre-receipt',pre,sources:pack.sources}));writeFileSync(obsFile,JSON.stringify({kind:'observation-receipt',observation:before}));
 const coordinator=fixture113Coordinator({authorized:true,runId,revision,outputDir:dir,resume:{preFile,preFileSha256:hash(readFileSync(preFile)),observationFile:obsFile,observationFileSha256:hash(readFileSync(obsFile)),partCount:2}});
 const require=createRequire(import.meta.url),cp=require('node:child_process'),previous=cp.spawn,commands=[];let captured;
 const wrapperHash=hash(readFileSync(fileURLToPath(new URL('../../../deploy/acceptance/crm-modernization-staging.py',import.meta.url))));
 cp.spawn=(command,args)=>{assert.ok(['scp','ssh'].includes(command),'unexpected real subprocess forbidden');commands.push(command);const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin=new EventEmitter();proc.stdin.end=input=>queueMicrotask(()=>{let out='';if(args.includes('sha256sum'))out=wrapperHash+'  synthetic.py\n';else if(commands.length===3){const packet=JSON.parse(input);captured=packet.input;out=JSON.stringify({identity:{hostname:'crm-staging',revision},bundleSha256:packet.bundleSha256,operation:'inspect',exitCode:0,result:{status:'DELETE_ACK',ack}});}proc.stdout.emit('data',Buffer.from(out));proc.emit('close',0);});return proc;};syncBuiltinESMExports();
 try{
  const result=await coordinator.afterDelete(intent);assert.equal(digest(result),digest(ack));assert.deepEqual(commands,['scp','ssh','ssh']);
  assert.equal(captured.mode,'delete-ack');assert.equal(captured.operation,'inspect');assert.equal(Object.hasOwn(captured,'priorObservation'),false);assert.equal(digest(captured.pre),digest(pre));assert.equal(digest(captured.deleteIntent),digest(intent));assert.equal(captured.deleteIntentSha256,digest(intent));
  assert.deepEqual(captured.deleteIntent.observation.scope.File,[oldId,deletedId]);assert.deepEqual(captured.deleteIntent.observation.keys,keys);assert.equal(captured.deleteIntent.observation.signature,before.signature);
  const size=value=>Buffer.from(JSON.stringify(value).replace(/[\u0080-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))).toString('base64').length;
  assert.ok(size(captured)<=96*1024);assert.ok(size({...captured,priorObservation:before})>96*1024);
  const main=readFileSync(new URL('./file-fixture113-entry.mjs',import.meta.url),'utf8');assert.match(main,/observe\(db,s3,pre,\{\.\.\.input,priorObservation:intent\.observation\},secret\)/);
 }finally{cp.spawn=previous;syncBuiltinESMExports();}
});