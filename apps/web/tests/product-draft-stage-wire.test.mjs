import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {assertTechnicalPersistence,encodeFunctionalWire,decodeFunctionalWire,INPUT_WIRE_LIMIT,DECODED_LIMIT} from './product-draft-stage-wire.mjs';
const technical={runId:'80502171-fcf9-4189-a3f8-c8a77e94efad',revision:'a'.repeat(40),signature:'b'.repeat(64),rows:{Product:{count:'1',hash:'c'.repeat(64)}},tokens:[{idHash:'d'.repeat(64),lastUsedAt:null}],preferences:{'products.list':JSON.stringify({version:2,revision:'80502171-fcf9-4189-a3f8-c8a77e94efad',query:'view=kanban'})}};
test('bounded canonical technical signed evidence roundtrips without credentials',()=>{assert.deepEqual(decodeFunctionalWire(encodeFunctionalWire(technical)),technical);});
test('nested and JSON-string embedded private handoff cannot be persisted',()=>{for(const value of [{value:{cookies:[{name:'authjs.session-token',value:'secret'}]}},{value:JSON.stringify({basicAuth:{username:'x',password:'y'}})},{value:{profile:{id:'own'}}},{value:'Bearer private-token'},{value:'a'.repeat(24)+'.'+'b'.repeat(24)+'.'+'c'.repeat(24)},{value:{passwordDisabled:'secret'}}])assert.throws(()=>assertTechnicalPersistence(value),/PRIVATE/);});
test('unknown fields encoding and invalid base64 are rejected',()=>{const wire=encodeFunctionalWire(technical);for(const bad of [{...wire,extra:1},{...wire,kind:'other'},{...wire,encoding:'raw'},{...wire,data:wire.data+' '},{...wire,data:wire.data.slice(1)}])assert.throws(()=>decodeFunctionalWire(bad));});
test('truncation hash mismatch and declared byte mismatch fail closed',()=>{const wire=encodeFunctionalWire(technical);for(const bad of [{...wire,data:wire.data.slice(0,-8)},{...wire,decodedSha256:'e'.repeat(64)},{...wire,decodedBytes:wire.decodedBytes+1}])assert.throws(()=>decodeFunctionalWire(bad));});
test('decompression output and compressed wire budgets cannot be widened',()=>{const bytes=Buffer.alloc(DECODED_LIMIT+1,32),wire={kind:'product-draft-stage-wire',version:1,encoding:'gzip-base64',decodedBytes:DECODED_LIMIT,decodedSha256:createHash('sha256').update(bytes).digest('hex'),data:gzipSync(bytes).toString('base64')};assert.throws(()=>decodeFunctionalWire(wire),/GZIP/);const good=encodeFunctionalWire(technical);assert.throws(()=>decodeFunctionalWire({...good,data:'a'.repeat(INPUT_WIRE_LIMIT)}),/LIMIT/);assert.throws(()=>encodeFunctionalWire(technical,{maxWireBytes:10*1024*1024}),/FIXED/);});
test('canonical JSON proof rejects reordered or whitespace payload despite valid SHA',()=>{const bytes=Buffer.from(JSON.stringify(technical)),wire={kind:'product-draft-stage-wire',version:1,encoding:'gzip-base64',decodedBytes:bytes.length,decodedSha256:createHash('sha256').update(bytes).digest('hex'),data:gzipSync(bytes).toString('base64')};assert.throws(()=>decodeFunctionalWire(wire),/NONCANONICAL/);});

test('outer phase operation full candidate and signed proof scopes cannot be substituted',async()=>{
 const {packFunctionalInput,unpackFunctionalInput}=await import('./product-draft-stage-wire.mjs'),common={phase:'capture',operation:'inspect',revision:'a'.repeat(40),runId:technical.runId,authorized:true},signed={revision:common.revision,runId:common.runId,signature:'b'.repeat(64)};
 const input=packFunctionalInput(common,{checkpoint:signed});assert.equal(unpackFunctionalInput(input).checkpoint.signature,signed.signature);
 for(const bad of [{...input,operation:'prepare'},{...input,phase:'unknown'},{...input,authorized:false},{...input,revision:'main'},{...input,runId:'bad'}])assert.throws(()=>unpackFunctionalInput(bad),/BINDING/);
 for(const checkpoint of [{...signed,runId:'foreign'},{...signed,revision:'c'.repeat(40)},{...signed,signature:'bad'}])assert.throws(()=>packFunctionalInput(common,{checkpoint}),/BINDING/);
 assert.throws(()=>packFunctionalInput(common,{operation:'restore'}),/FIELDS/);
});
