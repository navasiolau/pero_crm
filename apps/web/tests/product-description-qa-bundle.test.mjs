import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {descriptionSessionSource,descriptionFixtureSource,replaceReviewedOnce,bundleProductDescriptionQa} from './product-description-qa-bundle.mjs';
const session=await readFile(new URL('./project-inline-session.mjs',import.meta.url),'utf8'),fixture=await readFile(new URL('./product-inline-browser-fixtures.mjs',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
test('description19 session uses a separate namespace and captures product.tab for the existing readonly cohort',()=>{
 const variant=descriptionSessionSource(session);assert.match(variant,/PERO_PRODUCT_DESCRIPTION_SESSION_V1/);assert.match(variant,/PREF_KEYS = \["projects.list", "project.tab", "product.tab"\]/);assert.match(variant,/ACCOUNTANT/);assert.match(variant,/WORKER/);assert.match(variant,/MOUNTER/);
 for(const guard of ['CHECKPOINT_SIGNATURE_MISMATCH','DATABASE_IDENTITY_MISMATCH','PREFERENCE_CAS_RACE','VERIFIED_STAGE_PROOF_REQUIRED'])assert.ok(variant.includes(guard));assert.ok(session.includes('PERO_CRM_PROJECT_INLINE_SESSION_V1'));
});
test('fixture19 verifies signed session before transaction writes, binds actor IDs and preserves original V2 security',()=>{
 const variant=descriptionFixtureSource(fixture);assert.match(variant,/PERO_PRODUCT_DESCRIPTION_BROWSER_FIXTURES_V1/);assert.ok(variant.indexOf('const profiles=descriptionSessionProfiles(input.sessionCheckpoint,secret)')<variant.indexOf('await tx.client.create'));assert.match(variant,/sessionCheckpointHash:hash\(input.sessionCheckpoint\)/);assert.match(variant,/DESCRIPTION_SESSION_SIGNATURE_MISMATCH/);assert.match(variant,/where:\{id:\{in:Object.values\(profiles\)/);assert.match(variant,/descriptionB:' \\t\\r\\n\\r\\n'/);
 for(const guard of ['NONOWNED_AUDIT_ACTOR_STOP','UNMATCHED_CONTACT_AUDIT_STOP','POST_CLEANUP_ORIGINAL_DATA_MISMATCH_STOP','OWNED_ROW_CAS_CONFLICT_STOP'])assert.ok(variant.includes(guard));assert.ok(fixture.includes('PERO_PRODUCT_INLINE_BROWSER_FIXTURES_V2'));
});
test('reviewed transform stops on missing or duplicate source seams instead of editing an unreviewed function',()=>{
 assert.throws(()=>replaceReviewedOnce('a','missing','x'),/SOURCE_SEAM_CHANGED/);assert.throws(()=>replaceReviewedOnce('a a','a','x'),/SOURCE_SEAM_CHANGED/);assert.throws(()=>descriptionSessionSource(session.replace('const PREF_KEYS','const RENAMED_KEYS')),/SOURCE_SEAM_CHANGED/);assert.throws(()=>descriptionFixtureSource(fixture+"const ids=Object.fromEntries([]);"),/ACTOR_SOURCE_CHANGED/);
});
test('build-only variants fit guarded transport and leave source17/18 hashes unchanged',async()=>{
 const results=await Promise.all([bundleProductDescriptionQa('product-description-session.mjs'),bundleProductDescriptionQa('product-description-browser-fixtures.mjs')]);assert.ok(results.every(bytes=>bytes.length>0&&bytes.length<=256*1024));assert.equal(sha(await readFile(new URL('./project-inline-session.mjs',import.meta.url),'utf8')),sha(session));assert.equal(sha(await readFile(new URL('./product-inline-browser-fixtures.mjs',import.meta.url),'utf8')),sha(fixture));
});


test('actual generated fixture binding rejects forged/tampered profile signatures before DB writes',()=>{
 const variant=descriptionFixtureSource(fixture);const start=variant.indexOf('function descriptionSessionProfiles('),end=variant.indexOf('async function prepare(',start);const functionSource=variant.slice(start,end);
 const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
 const gate=(ok,code)=>{if(!ok)throw Error(code)};const verify=new Function('createHmac','timingSafeEqual','requireThat','canonical',functionSource+';return descriptionSessionProfiles;')(createHmac,timingSafeEqual,gate,canonical);
 const secret='test-only-signing-secret';const unsigned={namespace:'PERO_PRODUCT_DESCRIPTION_SESSION_V1',version:1,profiles:{admin:{id:'a',roles:['ADMIN']},manager:{id:'m',roles:['MANAGER']},engineer:{id:'e',roles:['ENGINEER']}}};const signed={...unsigned,signature:createHmac('sha256',secret).update(unsigned.namespace+'\0').update(canonical(unsigned)).digest('hex')};
 assert.deepEqual(verify(signed,secret),unsigned.profiles);assert.throws(()=>verify({...signed,profiles:{...signed.profiles,engineer:{id:'foreign',roles:['ENGINEER']}}},secret),/SIGNATURE_MISMATCH/);assert.throws(()=>verify({...signed,namespace:'PERO_CRM_PROJECT_INLINE_SESSION_V1'},secret),/CHECKPOINT_REQUIRED/);assert.throws(()=>verify({...signed,signature:'0'.repeat(64)},secret),/SIGNATURE_MISMATCH/);
});
