import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {test} from 'node:test';
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
function load(name,exports,values={}){const source=readFileSync(new URL(name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{[^\n]*\};?\s*$/gm,'').replace(/await main\(\);\s*$/,'');return Function('Prisma','createHash','createHmac','randomUUID','timingSafeEqual','_canonicalInput','_hashInput',`${values.canonical?'const canonical=_canonicalInput;const hash=_hashInput;':''}${source};return {${exports}};`)({ModelName:{ApiToken:'ApiToken',User:'User'}},createHash,createHmac,randomUUID,timingSafeEqual,values.canonical,values.hash);}
const v2=load('./product-inline-browser-fixtures.mjs','snapshot,verify,sign,canonical');
const v1=load('./product-inline-fixture-v1-internals.mjs','snapshot,verify,sign');
const recon=load('./product-inline-reconcile.mjs','outsideGuard,observationCas,signature,verifyObservation',{canonical:stable,hash:value=>createHash('sha256').update(stable(value)).digest('hex')});
function adapter(){const rows={ApiToken:[{id:'token',name:'health',prefix:'prefix',tokenHash:'credential-hash',scopes:['read'],pluginId:null,createdById:'owner',createdAt:'2026-01-01',lastUsedAt:'2026-01-02',revokedAt:null}],User:[{id:'owner',roles:['ADMIN'],updatedAt:'2026-01-01'}],_prisma_migrations:[]};return{rows,tx:{$queryRawUnsafe:async sql=>{const table=/FROM "([^"]+)" t/.exec(sql)[1];const dropped=/to_jsonb\(t\) - '([^']+)'/.exec(sql)?.[1];const projected=rows[table].map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!==dropped)));return[{count:String(projected.length),hash:createHash('md5').update(projected.map(stable).sort().join('')).digest('hex')}];}}};}
test('V2 health lastUsedAt alone is operational; all token security fields and counts remain protected',async()=>{
 const f=adapter(),original=await v2.snapshot(f.tx);f.rows.ApiToken[0].lastUsedAt='2026-02-01';assert.deepEqual(await v2.snapshot(f.tx),original);
 for(const [field,value]of Object.entries({id:'other',name:'other',prefix:'other',tokenHash:'other',scopes:['write'],pluginId:'plugin',createdById:'other',createdAt:'2026-02-01',revokedAt:'2026-02-01'})){const saved=f.rows.ApiToken[0][field];f.rows.ApiToken[0][field]=value;assert.notDeepEqual((await v2.snapshot(f.tx)).ApiToken,original.ApiToken,field);f.rows.ApiToken[0][field]=saved;}
 f.rows.ApiToken.push({...f.rows.ApiToken[0],id:'new'});assert.notDeepEqual((await v2.snapshot(f.tx)).ApiToken,original.ApiToken);f.rows.User[0].updatedAt='2026-02-01';assert.notDeepEqual((await v2.snapshot(f.tx)).User,original.User);
});
test('frozen V1 raw fingerprint and signature remain distinct from V2 operational profile',async()=>{
 const f=adapter(),original=await v1.snapshot(f.tx);f.rows.ApiToken[0].lastUsedAt='2026-02-01';assert.notDeepEqual((await v1.snapshot(f.tx)).ApiToken,original.ApiToken);
 const cp={kind:'checkpoint',namespace:'PERO_PRODUCT_INLINE_BROWSER_FIXTURES_V1',runId:randomUUID()};cp.signature=v1.sign(cp,'secret');v1.verify(cp,'secret','checkpoint');assert.throws(()=>v2.verify(cp,'secret','checkpoint'),/SIGNED_SCOPE_INVALID/);
});
test('V1 owned reconciliation acknowledges only ApiToken raw drift and refuses any other table or count change',()=>{
 const cp={baseline:{ApiToken:{count:'3',hash:'old'},User:{count:'1',hash:'same'}}};const current={ApiToken:{count:'3',hash:'current'},User:{count:'1',hash:'same'}};recon.outsideGuard(current,cp);
 assert.throws(()=>recon.outsideGuard({...current,User:{count:'1',hash:'changed'}},cp),/ORIGINAL_User_CHANGED_STOP/);assert.throws(()=>recon.outsideGuard({...current,ApiToken:{count:'4',hash:'current'}},cp),/APITOKEN_ROW_COUNT_CHANGED_STOP/);
 const state={rows:{owned:'same'},sideEffects:{owned:'same'},outside:current};const obs={ownedRows:state.rows,effects:state.sideEffects,currentOutsideRaw:structuredClone(current)};recon.observationCas(state,obs);state.outside.ApiToken.hash='concurrent-health-or-security';assert.throws(()=>recon.observationCas(state,obs),/CURRENT_RAW_SECURITY_CAS_CONFLICT_STOP/);
});
