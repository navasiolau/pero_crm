// QA117: только собственные четыре fixture rows и две composite preference keys.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {normalizeListQuery} from '../src/lib/list-state.ts';
import {encodeListFilterValue} from '../src/lib/list-filter-values.ts';
export const SEARCH117_NAMESPACE='PERO_KANBAN_SEARCH_OWNED_117_V1';
export const SEARCH117_PREF_KEYS=['projects.list','products.list'];
export const SEARCH117_TABLES=['User','Client','Project','Product'];
export const SEARCH117_ACTION_ROUTES=['app/(app)/products/page','app/(app)/projects/page'];
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const need117=(ok,code)=>{if(!ok)throw Error(code);};
export function canonical117(value){const normalized=JSON.parse(JSON.stringify(value));const walk=item=>Array.isArray(item)?'['+item.map(walk).join(',')+']':item&&typeof item==='object'?'{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+walk(item[key])).join(',')+'}':JSON.stringify(item);return walk(normalized);}
export const digest117=value=>createHash('sha256').update(canonical117(value)).digest('hex');
export const bytes117=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sign117(value,secret){need117(typeof secret==='string'&&secret.length>0,'K117_OWNERSHIP_SECRET_REQUIRED');return{...value,signature:createHmac('sha256',secret).update(SEARCH117_NAMESPACE+'\0'+canonical117(value)).digest('hex')};}
export function verify117(value,secret,kind,input){
 need117(value?.namespace===SEARCH117_NAMESPACE&&value.version===1&&value.kind===kind&&value.runId===input.runId&&value.revision===input.revision&&SHA.test(value.signature??''),'K117_SIGNED_SCOPE_REQUIRED');
 const{signature,...body}=value,expected=sign117(body,secret).signature;need117(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'K117_SIGNED_SCOPE_TAMPERED');return body;
}
export function basic117(input){need117(input?.authorized===true&&REV.test(input.revision??'')&&UUID.test(input.runId??''),'K117_AUTHORIZED_FRESH_STAGE_REQUIRED');}
export function plan117(input){
 basic117(input);const tag=input.runId.replaceAll('-','');
 return{runId:input.runId,revision:input.revision,ids:{actor:randomUUID(),client:randomUUID(),project:randomUUID(),product:randomUUID()},email:'qa117-'+input.runId+'@invalid.test',passwordHash:'QA117_DISABLED_NOT_A_PASSWORD_HASH',actorName:'QA117-'+tag+'-ACTOR',
  tokens:{projectTitle:'QA117-'+tag+'-PROJECT',productTitle:'QA117-'+tag+'-PRODUCT',client:'QA117-'+tag+'-CLIENT',technical:'QA117-'+tag+'-TECH'},number:null};
}
/** Фактический Next15 manifest имеет filename server/...; public source нормализуется до src/... только здесь. */
export function extractPreferenceAction117(manifestBytes,revision){
 need117(REV.test(revision??''),'K117_MANIFEST_REVISION_REQUIRED');const bytes=Buffer.from(manifestBytes);need117(bytes.length>0&&bytes.length<=4*1024*1024,'K117_MANIFEST_BYTES_LIMIT');let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw Error('K117_MANIFEST_JSON_REQUIRED');}
 need117(manifest?.node&&typeof manifest.node==='object'&&!Array.isArray(manifest.node),'K117_NODE_MANIFEST_REQUIRED');
 const matches=Object.entries(manifest.node).filter(([,entry])=>entry?.exportedName==='saveListPreference');need117(matches.length===1,'K117_UNIQUE_COMPILED_PREFERENCE_REQUIRED');
 const[id,entry]=matches[0];need117(/^[a-f0-9]{42}$/.test(id)&&entry.filename==='server/list-preferences-actions.ts'&&entry.workers&&entry.layer,'K117_COMPILED_SOURCE_ABI_MISMATCH');
 const routes=SEARCH117_ACTION_ROUTES.map(route=>{const worker=entry.workers[route];need117(worker&&typeof worker.moduleId==='string'&&/^[0-9]{1,12}$/.test(worker.moduleId)&&worker.async===false&&entry.layer[route]==='action-browser','K117_COMPILED_WORKER_ABI_MISMATCH');return{route,moduleId:worker.moduleId,async:false,layer:'action-browser'};});
 return{action:{id,exportedName:'saveListPreference',filename:'src/server/list-preferences-actions.ts',revision,manifestSha256:bytes117(bytes)},routes};
}
export function ownedQuery117(section,term,plan){need117(['projects','products'].includes(section),'K117_PREF_SECTION_INVALID');const terms=section==='projects'?[plan.number,plan.tokens.projectTitle,plan.tokens.client,plan.tokens.technical,plan.tokens.productTitle]:[plan.number+'.1',plan.tokens.productTitle,plan.tokens.client,plan.tokens.technical,plan.tokens.projectTitle];need117(term===''||terms.includes(term),'K117_PREF_TERM_OUTSIDE_OWN');const params=new URLSearchParams({view:'kanban'});if(term)params.set('q',term);params.set(section==='projects'?'client':'project',encodeListFilterValue([section==='projects'?plan.ids.client:plan.ids.project]));params.set('active','0');return normalizeListQuery(section,params.toString());}
export function validatePreferenceEvents117(events,pre){
 need117(Array.isArray(events)&&events.length<=200,'K117_BOUNDED_PREFERENCE_JOURNAL_REQUIRED');const pending=new Map(),values=new Map(),seen=new Set();let previous=0;
 for(const event of events){
  need117(event&&event.runId===pre.runId&&event.revision===pre.revision&&event.actorId===pre.plan.ids.actor&&event.sequence===++previous&&SEARCH117_PREF_KEYS.includes(event.key)&&UUID.test(event.requestId??'')&&['INTENT','ACK'].includes(event.kind),'K117_JOURNAL_EVENT_SCOPE_MISMATCH');
  if(event.kind==='INTENT'){
   need117(!pending.size&&!seen.has(event.requestId)&&event.key===event.section+'.list'&&typeof event.query==='string'&&event.expected===(values.get(event.key)??null)&&/^[a-f0-9]{42}$/.test(event.actionId??'')&&SHA.test(event.bodySha256??''),'K117_JOURNAL_INTENT_CAS_MISMATCH');
   need117(event.query===ownedQuery117(event.section,new URLSearchParams(event.query).get('q')??'',pre.plan),'K117_JOURNAL_QUERY_OUTSIDE_OWN');pending.set(event.requestId,event);seen.add(event.requestId);
  }else{
   const intent=pending.get(event.requestId);need117(intent&&intent.key===event.key&&typeof event.value==='string'&&SHA.test(event.responseSha256??'')&&event.httpStatus===200,'K117_JOURNAL_ACK_MISMATCH');
   let decoded;try{decoded=JSON.parse(event.value);}catch{throw Error('K117_JOURNAL_ACK_JSON_INVALID');}need117(decoded.version===2&&UUID.test(decoded.revision??'')&&decoded.query===intent.query,'K117_JOURNAL_ACK_VALUE_MISMATCH');values.set(event.key,event.value);pending.delete(event.requestId);
  }
 }
 need117(!pending.size,'K117_UNRESOLVED_PREFERENCE_JOURNAL_STOP');return[...values].map(([key,value])=>({userId:pre.plan.ids.actor,key,value}));
}

export function assertCurrentCertificate117(certificate,handoff,sources){need117(certificate?.namespace===SEARCH117_NAMESPACE&&certificate.version===1&&certificate.kind==='current-browser-verification'&&certificate.runId===handoff.runId&&certificate.revision===handoff.revision&&certificate.handoffHash===digest117(handoff)&&certificate.originalPreSha256===handoff.originalPreSha256&&certificate.actorId===handoff.actor.id&&certificate.actionManifestSha256===handoff.action.manifestSha256&&certificate.verifierSourceSha256===sources['kanban-search-owned-fixtures.mjs']&&SHA.test(certificate.signature??''),'K117_CURRENT_PRODUCER_CERTIFICATE_MISMATCH');return certificate;}
