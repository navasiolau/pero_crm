import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {acceptanceWeb} from './crm-acceptance-transport.mjs';
import {functionalOptions,makeTechnicalStore,functionalBundle} from './product-draft-stage-runner.mjs';
const base=path.join(acceptanceWeb,'test-results');
function ownedStore(work){const directory=path.join(base,'draft111-pure-'+randomUUID());mkdirSync(directory,{recursive:true});try{return work(directory);}finally{for(const name of readdirSync(directory)){const absolute=path.join(directory,name);assert.equal(path.dirname(absolute),directory);unlinkSync(absolute);}rmdirSync(directory);}}
const runId='80502171-fcf9-4189-a3f8-c8a77e94efad',options={phase:'plan',revision:'a'.repeat(40),runId,outputDir:path.join(base,'draft111-functional-'+runId),authorized:true};
test('full approved candidate and exact private lifecycle options are required',()=>{
 assert.equal(functionalOptions(options).runId,runId);
 for(const bad of [{...options,authorized:false},{...options,revision:'staging'},{...options,runId:'bad'},{...options,phase:'native'},{...options,outputDir:path.join(base,'another-run')},{...options,extra:'unexpected'}])assert.throws(()=>functionalOptions(bad));
});
test('immutable technical artifacts and fsynced chain survive a separate store load',()=>ownedStore(directory=>{
 const first=makeTechnicalStore(directory);first.put('pre',{kind:'pre',runId,signature:'b'.repeat(64)});first.put('journal',{runId,actions:[]});
 const second=makeTechnicalStore(directory);assert.equal(second.get('pre').signature,'b'.repeat(64));assert.deepEqual(second.get('journal').actions,[]);second.put('receipt-capture',{status:'CAPTURED'});
 assert.equal(makeTechnicalStore(directory).get('receipt-capture').status,'CAPTURED');assert.equal(readFileSync(path.join(directory,'ledger.jsonl'),'utf8').trim().split('\n').length,3);
}));
test('changed artifact and incomplete or modified ledger fail closed',()=>ownedStore(directory=>{
 const store=makeTechnicalStore(directory),saved=store.put('pre',{kind:'pre',runId});writeFileSync(saved.file,'{"kind":"changed"}\n');assert.throws(()=>store.get('pre'),/ARTIFACT_CHANGED/);
 const ledger=path.join(directory,'ledger.jsonl'),original=readFileSync(ledger,'utf8');writeFileSync(ledger,original.trimEnd());assert.throws(()=>makeTechnicalStore(directory),/LEDGER_COMPLETE/);writeFileSync(ledger,original.replace('"index":0','"index":7'));assert.throws(()=>makeTechnicalStore(directory),/LEDGER_CHAIN/);
}));
test('private handoff or nested credentials cannot create an artifact',()=>ownedStore(directory=>{
 const store=makeTechnicalStore(directory);assert.throws(()=>store.put('handoff',{profile:{cookies:[{name:'authjs.session-token',value:'private'}]}}),/PRIVATE/);assert.equal(readdirSync(directory).length,0);
 assert.throws(()=>store.put('wrapped',{value:JSON.stringify({basicAuth:{password:'private'}})}),/PRIVATE/);assert.equal(readdirSync(directory).length,0);assert.equal(existsSync(path.join(directory,'ledger.jsonl')),false);
}));
test('both reviewed root bundles build offline within fixed wrapper budget',async()=>{
 for(const privateHandoff of [false,true]){const bytes=await functionalBundle({privateHandoff});assert.ok(bytes.length>0&&bytes.length<=256*1024);const source=bytes.toString('utf8');assert.ok(source.includes('createRequire'));assert.ok(source.includes(privateHandoff?'PRIVATE_BROWSER_HANDOFF':'TECHNICAL_RESULT'));}
});
