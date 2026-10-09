// Fresh baseline only: this evidence cannot reinterpret an older full-table fingerprint.
// No DB/network action on import. Caller supplies one RR READ ONLY transaction.
import {createHash} from 'node:crypto';
const HASH=/^[a-f0-9]{64}$/,COUNT=/^(?:0|[1-9][0-9]{0,19})$/;
const need=(ok,code)=>{if(!ok)throw Error(code);};
function keys(value,fields,code){need(value!==null&&typeof value==='object'&&!Array.isArray(value),code);need(JSON.stringify(Object.keys(value).sort())===JSON.stringify([...fields].sort()),code);}
function iso(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
export function validateTokenClockEvidence(value){
 keys(value,['kind','version','capturedAt','stable','legacyStable','full','tokens'],'TOKEN_CLOCK_EVIDENCE_FIELDS');
 need(value.kind==='crm-api-token-clock'&&value.version===1&&iso(value.capturedAt),'TOKEN_CLOCK_FRESH_EVIDENCE_REQUIRED');
 for(const field of ['stable','full']){keys(value[field],['count','hash'],'TOKEN_CLOCK_FINGERPRINT_FIELDS');need(COUNT.test(value[field].count)&&HASH.test(value[field].hash),'TOKEN_CLOCK_FINGERPRINT_INVALID');}
 keys(value.legacyStable,['count','hash'],'TOKEN_CLOCK_LEGACY_FIELDS');need(value.legacyStable.count===value.stable.count&&/^[a-f0-9]{32}$/.test(value.legacyStable.hash),'TOKEN_CLOCK_LEGACY_INVALID');
 need(Array.isArray(value.tokens)&&value.tokens.length<=10000&&value.stable.count===String(value.tokens.length)&&value.full.count===value.stable.count,'TOKEN_CLOCK_COHERENT_COUNT');
 let previous='';
 for(const token of value.tokens){
  keys(token,['idHash','lastUsedAt'],'TOKEN_CLOCK_TOKEN_FIELDS');
  need(HASH.test(token.idHash)&&token.idHash>previous,'TOKEN_CLOCK_ID_SET_INVALID');previous=token.idHash;
  need(token.lastUsedAt===null||(iso(token.lastUsedAt)&&Date.parse(token.lastUsedAt)<=Date.parse(value.capturedAt)),'TOKEN_CLOCK_FUTURE_OR_INVALID');
 }
 return value;
}
export function compareTokenClockEvidence(before,after){
 validateTokenClockEvidence(before);validateTokenClockEvidence(after);
 need(Date.parse(after.capturedAt)>=Date.parse(before.capturedAt),'TOKEN_CLOCK_CAPTURE_MOVED_BACKWARD');
 need(after.stable.count===before.stable.count&&after.stable.hash===before.stable.hash&&after.legacyStable.hash===before.legacyStable.hash,'TOKEN_CLOCK_STABLE_FIELDS_CHANGED');
 need(after.tokens.length===before.tokens.length&&after.tokens.every((token,index)=>token.idHash===before.tokens[index].idHash),'TOKEN_CLOCK_ID_SET_CHANGED');
 let changed=false;
 for(let index=0;index<before.tokens.length;index++){
  const old=before.tokens[index].lastUsedAt,current=after.tokens[index].lastUsedAt;
  need(old===null||current!==null,'TOKEN_CLOCK_DATE_BECAME_NULL');
  need(old===null||Date.parse(current)>=Date.parse(old),'TOKEN_CLOCK_LASTUSE_MOVED_BACKWARD');
  changed||=old!==current;
 }
 if(!changed)need(after.full.hash===before.full.hash,'TOKEN_CLOCK_FULL_DRIFT_WITHOUT_CLOCK_CHANGE');
 else need(after.full.hash!==before.full.hash,'TOKEN_CLOCK_INCOHERENT_FULL_FINGERPRINT');
 return {valid:true,changed,stableFieldsMatched:true,tokenCount:after.tokens.length};
}
export async function captureTokenClockEvidence(tx){
 const[identity]=await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') readonly,current_setting('transaction_isolation') isolation");
 need(identity?.readonly==='on'&&['repeatable read','serializable'].includes(identity.isolation),'TOKEN_CLOCK_RR_READONLY_REQUIRED');
 const[hashes]=await tx.$queryRawUnsafe(`SELECT count(*)::text count,
  encode(sha256(convert_to(COALESCE(string_agg(stable_hash,'' ORDER BY stable_hash),''),'UTF8')),'hex') AS "stableHash",
  encode(sha256(convert_to(COALESCE(string_agg(full_hash,'' ORDER BY full_hash),''),'UTF8')),'hex') AS "fullHash",
  md5(COALESCE(string_agg(stable_document,'' ORDER BY stable_document),'')) AS "legacyHash"
 FROM (SELECT (to_jsonb(t)-'lastUsedAt')::text stable_document,
  encode(sha256(convert_to((to_jsonb(t)-'lastUsedAt')::text,'UTF8')),'hex') stable_hash,
  encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') full_hash
 FROM "ApiToken" t) hashes`);
 const tokens=await tx.$queryRawUnsafe(`SELECT encode(sha256(convert_to(t.id::text,'UTF8')),'hex') AS "idHash",
  CASE WHEN t."lastUsedAt" IS NULL THEN NULL ELSE to_char(t."lastUsedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "lastUsedAt"
 FROM "ApiToken" t ORDER BY "idHash"`);
 const[clock]=await tx.$queryRawUnsafe(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`);
 return validateTokenClockEvidence({kind:'crm-api-token-clock',version:1,capturedAt:clock.at,stable:{count:hashes.count,hash:hashes.stableHash},legacyStable:{count:hashes.count,hash:hashes.legacyHash},full:{count:hashes.count,hash:hashes.fullHash},tokens});
}
export function tokenClockEvidenceDigest(value){validateTokenClockEvidence(value);return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
