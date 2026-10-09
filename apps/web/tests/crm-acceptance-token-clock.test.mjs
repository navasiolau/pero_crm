import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {legacyTokenProjection,tokenProbeGuard} from './crm-acceptance-token-clock-entry.mjs';
import {captureTokenClockEvidence,compareTokenClockEvidence,validateTokenClockEvidence,tokenClockEvidenceDigest} from './crm-acceptance-token-clock.mjs';

function evidence(){
 return {kind:'crm-api-token-clock',version:1,capturedAt:'2026-10-09T00:10:00.000Z',stable:{count:'2',hash:'a'.repeat(64)},legacyStable:{count:'2',hash:'c'.repeat(32)},full:{count:'2',hash:'b'.repeat(64)},tokens:[{idHash:'1'.repeat(64),lastUsedAt:null},{idHash:'2'.repeat(64),lastUsedAt:'2026-10-09T00:00:00.000Z'}]};
}
function pair(){const before=evidence(),after=structuredClone(before);after.capturedAt='2026-10-09T00:20:00.000Z';return {before,after};}
test('unchanged fresh evidence confirms stable fields without clock exception',()=>{const {before,after}=pair();assert.deepEqual(compareTokenClockEvidence(before,after),{valid:true,changed:false,stableFieldsMatched:true,tokenCount:2});});
test('null becomes known past usage date with unchanged stable fields and IDs',()=>{const {before,after}=pair();after.tokens[0].lastUsedAt='2026-10-09T00:15:00.000Z';after.full.hash='d'.repeat(64);assert.equal(compareTokenClockEvidence(before,after).changed,true);});
test('known lastUsedAt moves forward only',()=>{const {before,after}=pair();after.tokens[1].lastUsedAt='2026-10-09T00:16:00.000Z';after.full.hash='d'.repeat(64);assert.equal(compareTokenClockEvidence(before,after).changed,true);});
test('date to null is rejected',()=>{const {before,after}=pair();after.tokens[1].lastUsedAt=null;after.full.hash='d'.repeat(64);assert.throws(()=>compareTokenClockEvidence(before,after));});
test('backwards usage and capture clocks are rejected',()=>{const {before,after}=pair();after.tokens[1].lastUsedAt='2026-10-08T23:59:00.000Z';assert.throws(()=>compareTokenClockEvidence(before,after));after.tokens[1].lastUsedAt=before.tokens[1].lastUsedAt;after.capturedAt='2026-10-09T00:09:00.000Z';assert.throws(()=>compareTokenClockEvidence(before,after));});
test('future usage date beyond DB capture clock is rejected',()=>{const after=evidence();after.tokens[1].lastUsedAt='2026-10-09T00:10:00.001Z';assert.throws(()=>validateTokenClockEvidence(after));});
test('stable fields including scope owner revocation and secret-derived values cannot change',()=>{const {before,after}=pair();after.stable.hash='d'.repeat(64);assert.throws(()=>compareTokenClockEvidence(before,after));});
test('compatible legacy stable projection is independently protected',()=>{const {before,after}=pair();after.legacyStable.hash='d'.repeat(32);assert.throws(()=>compareTokenClockEvidence(before,after));});
test('token membership and counts cannot change',()=>{const {before,after}=pair();after.tokens[0].idHash='0'.repeat(64);assert.throws(()=>compareTokenClockEvidence(before,after));after.tokens.pop();assert.throws(()=>validateTokenClockEvidence(after));});
test('whole-row drift is never accepted without measured clock change',()=>{const {before,after}=pair();after.full.hash='d'.repeat(64);assert.throws(()=>compareTokenClockEvidence(before,after));});
test('clock delta with unchanged full fingerprint is inconsistent',()=>{const {before,after}=pair();after.tokens[0].lastUsedAt='2026-10-09T00:15:00.000Z';assert.throws(()=>compareTokenClockEvidence(before,after));});
test('old aggregate-only baselines cannot retroactively acquire clock exception',()=>{assert.throws(()=>compareTokenClockEvidence({count:'3',hash:'c'.repeat(32)},evidence()));});
test('raw token data and unhashed identities are rejected',()=>{
 for(const mutate of [value=>{value.tokens[0].id='PRIVATE_ID';},value=>{value.tokens[0].tokenHash='PRIVATE_TOKEN';},value=>{value.stable.rows=[{name:'PRIVATE_NAME'}];},value=>{value.prefix='PRIVATE_PREFIX';}]){
  const value=evidence();mutate(value);assert.throws(()=>validateTokenClockEvidence(value));
 }
});
test('capture is four SELECT-only operations inside supplied readonly RR transaction',async()=>{
 const sample=evidence(),queries=[];
 const tx={async $queryRawUnsafe(sql){
  queries.push(sql);assert.match(sql,/^SELECT/);assert.doesNotMatch(sql,/\b(?:INSERT|DELETE|UPDATE|ALTER|CREATE)\b/);
  if(sql.includes("transaction_read_only"))return [{readonly:'on',isolation:'repeatable read'}];
  if(sql.includes('"stableHash"')){assert.ok(sql.includes("to_jsonb(t)-'lastUsedAt'"));assert.ok(sql.includes("string_agg(stable_document,'' ORDER BY stable_document)"));return [{count:'2',stableHash:sample.stable.hash,legacyHash:sample.legacyStable.hash,fullHash:sample.full.hash}];}
  if(sql.includes('"idHash"'))return sample.tokens;
  if(sql.includes('clock_timestamp()'))return [{at:sample.capturedAt}];
  throw Error('UNEXPECTED_SYNTHETIC_SQL');
 }};
 assert.deepEqual(await captureTokenClockEvidence(tx),sample);assert.equal(queries.length,4);
});
test('capture rejects ordinary READ COMMITTED or write transaction',async()=>{
 for(const identity of [{readonly:'off',isolation:'repeatable read'},{readonly:'on',isolation:'read committed'}]){
  const tx={async $queryRawUnsafe(){return [identity];}};await assert.rejects(captureTokenClockEvidence(tx));
 }
});
test('evidence digest is deterministic and includes clocks',()=>{const a=evidence(),b=structuredClone(a);assert.equal(tokenClockEvidenceDigest(a),tokenClockEvidenceDigest(b));b.tokens[1].lastUsedAt='2026-10-09T00:01:00.000Z';assert.notEqual(tokenClockEvidenceDigest(a),tokenClockEvidenceDigest(b));});

test('historical stable comparison requires original signed accepted checkpoint',()=>{
 const secret='dummy-test-secret',body={namespace:'PERO_ENGINEER_SKETCH_QA_112_V1',kind:'checkpoint',runId:'fa98ed24-49a0-419e-b03d-09422a7625df',revision:'322bd3d542e9d503e955127dc4c1f32644646bc4',baseline:{rows:{ApiToken:{count:'3',hash:'c3e20487b86c6ab8784656a510201b4c'}}}};
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
 const checkpoint={...body,signature:createHmac('sha256',secret).update(body.namespace+'\0'+canonical(body)).digest('hex')};
 assert.equal(legacyTokenProjection(checkpoint,secret).signatureVerified,true);
 assert.throws(()=>legacyTokenProjection({...checkpoint,baseline:{rows:{ApiToken:{count:'3',hash:'d'.repeat(32)}}}},secret));
 assert.throws(()=>legacyTokenProjection(checkpoint,'wrong-dummy-secret'));
 const revision='87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a',proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',web:'abcdef123456'+'1'.repeat(52),database:'2'.repeat(64),outerW07Sha256:'3'.repeat(64)};
 const input={operation:'inspect',mode:'token-clock',authorized:true,revision,runId:'80502171-fcf9-4189-a3f8-c8a77e94efad',checkpoint};
 const env={AUTH_SECRET:secret,CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://dummy:dummy@db:5432/crm?schema=public',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof)};
 assert.equal(tokenProbeGuard(input,env,{host:'abcdef123456',docker:true}).legacy.count,'3');
 assert.throws(()=>tokenProbeGuard({...input,authorized:false},env,{host:'abcdef123456',docker:true}));
 assert.throws(()=>tokenProbeGuard(input,{...env,CRM_MODERNIZATION_TARGET:'production'},{host:'abcdef123456',docker:true}));
 assert.throws(()=>tokenProbeGuard(input,{...env,DATABASE_URL:'postgresql://dummy:dummy@localhost:5433/pero_crm'},{host:'abcdef123456',docker:true}));
});