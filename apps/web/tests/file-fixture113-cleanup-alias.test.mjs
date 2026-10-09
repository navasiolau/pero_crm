// Один focused synthetic control: no stage/DB/HTTP/SSH/native.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {compactCleanupAliasInput,restoreCleanupAliasInput,cleanupAliasMetrics,checkedCleanupAliasSources} from './file-fixture113-cleanup-alias.mjs';
import {signed,digest,canonical,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
const pins={'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb','file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92','crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51'};
function fixture(padding=50*1024){
 const runId=randomUUID(),revision='c'.repeat(40),secret='SYNTHETIC_ALIAS_TEST_ONLY',base={namespace:FIXTURE_NAMESPACE,version:2,runId,revision};
 const pre=signed({...base,kind:'pre',sources:pins},secret),observation=signed({...base,kind:'observation',preSha256:digest(pre),scope:{File:['still-own','deleted-own']},keys:['own/original','own/deleted'],storage:[{key:'own/deleted',versionId:'known-marker',deleteMarker:true}],padding:'x'.repeat(padding)},secret);
 const cleanupIntent=signed({...base,kind:'cleanup-intent',preSha256:digest(pre),observationSha256:digest(observation)},secret);
 return {authorized:true,runId,revision,operation:'restore',mode:'cleanup',pre,preSha256:digest(pre),observation,priorObservation:observation,cleanupIntent,cleanupIntentSha256:digest(cleanupIntent)};
}
test('single observation carrier preserves exact full signed cleanup semantics and rejects every changed boundary',()=>{
 const input=fixture(),copy=compactCleanupAliasInput(input);assert.ok(copy.originalMetrics.encodedBytes>96*1024);assert.ok(copy.compactMetrics.encodedBytes<=96*1024);assert.equal(Object.hasOwn(copy.wire,'priorObservation'),false);
 const full=restoreCleanupAliasInput(copy.wire,copy.binding);assert.equal(full.priorObservation,full.observation);assert.equal(canonical(full),canonical(input));assert.equal(digest(full),copy.binding.originalFullInputHash);assert.deepEqual(full.observation.scope.File,input.observation.scope.File);assert.deepEqual(full.observation.keys,input.observation.keys);assert.equal(full.observation.signature,input.observation.signature);
 for(const patch of [{operation:'inspect'},{mode:'final'},{revision:'d'.repeat(40)},{authorized:false}])assert.throws(()=>compactCleanupAliasInput({...input,...patch}));
 assert.throws(()=>compactCleanupAliasInput({...input,priorObservation:{...input.observation,keys:['foreign']}}));assert.throws(()=>compactCleanupAliasInput({...input,pre:{...input.pre,sources:{...pins,'file-fixture113-entry.mjs':'0'.repeat(64)}}}));
 for(const key of ['originalFullInputHash','baseWireHash','observationSha256','cleanupIntentSha256','preSha256'])assert.throws(()=>restoreCleanupAliasInput(copy.wire,{...copy.binding,[key]:'0'.repeat(64)}));
 assert.throws(()=>restoreCleanupAliasInput({...copy.wire,observation:{...copy.wire.observation,signature:'0'.repeat(64)}},copy.binding));assert.throws(()=>restoreCleanupAliasInput({...copy.wire,priorObservation:input.observation},copy.binding));assert.throws(()=>compactCleanupAliasInput(fixture(100*1024)));
 assert.throws(()=>checkedCleanupAliasSources(()=>Buffer.from('WRONG_BACKEND')));
 const historicalRead=name=>{const text=readFileSync(new URL('./'+name,import.meta.url),'utf8'),eol=name==='file-fixture113-protocol.mjs'?'\n':'\r\n';return Buffer.from(text.replace(/\r?\n/g,eol));};
 const actualSources=checkedCleanupAliasSources(historicalRead);assert.equal(Object.keys(actualSources).length,3);
 assert.equal(cleanupAliasMetrics({text:'Файл😀'}).decodedBytes,Buffer.byteLength('{"text":"\\u0424\\u0430\\u0439\\u043b\\ud83d\\ude00"}'));

});