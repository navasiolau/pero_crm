// QA117: только собственные четыре fixture rows и две composite preference keys.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {normalizeListQuery} from '../src/lib/list-state.ts';
import {encodeListFilterValue} from '../src/lib/list-filter-values.ts';
export const SEARCH117_NAMESPACE='PERO_KANBAN_SEARCH_OWNED_117_V1';
export const COHORT163_NAMESPACE='PERO_KANBAN_SEARCH_OWNED_163_V2';
export const SEARCH117_PREF_KEYS=['projects.list','products.list'];
export const SEARCH117_TABLES=['User','Client','Project','Product'];
export const SEARCH117_ACTION_ROUTES=['app/(app)/products/page','app/(app)/projects/page'];
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const need117=(ok,code)=>{if(!ok)throw Error(code);};
export function canonical117(value){const normalized=JSON.parse(JSON.stringify(value));const walk=item=>Array.isArray(item)?'['+item.map(walk).join(',')+']':item&&typeof item==='object'?'{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+walk(item[key])).join(',')+'}':JSON.stringify(item);return walk(normalized);}
export const digest117=value=>createHash('sha256').update(canonical117(value)).digest('hex');
export const bytes117=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sign117(value,secret){need117(typeof secret==='string'&&secret.length>0,'K117_OWNERSHIP_SECRET_REQUIRED');return{...value,signature:createHmac('sha256',secret).update((value.namespace??SEARCH117_NAMESPACE)+'\0'+canonical117(value)).digest('hex')};}
export function verify117(value,secret,kind,input){
 need117(value?.namespace===envelope117(input).namespace&&value.version===envelope117(input).version&&value.kind===kind&&value.runId===input.runId&&value.revision===input.revision&&SHA.test(value.signature??''),'K117_SIGNED_SCOPE_REQUIRED');
 if(input.registry)need117(value.registrySha256===input.registrySha256&&digest117(input.registry)===input.registrySha256,'K117_SIGNED_REGISTRY_MISMATCH');
 const{signature,...body}=value,expected=sign117(body,secret).signature;need117(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'K117_SIGNED_SCOPE_TAMPERED');return body;
}
export function basic117(input){need117(input?.authorized===true&&REV.test(input.revision??'')&&UUID.test(input.runId??''),'K117_AUTHORIZED_FRESH_STAGE_REQUIRED');}
export function plan117(input){
 basic117(input);if(input.registry)return cohortPlan163(input);const tag=input.runId.replaceAll('-','');
 return{runId:input.runId,revision:input.revision,ids:{actor:randomUUID(),client:randomUUID(),project:randomUUID(),product:randomUUID()},email:'qa117-'+input.runId+'@invalid.test',passwordHash:'QA117_DISABLED_NOT_A_PASSWORD_HASH',actorName:'QA117-'+tag+'-ACTOR',
  tokens:{projectTitle:'QA117-'+tag+'-PROJECT',productTitle:'QA117-'+tag+'-PRODUCT',client:'QA117-'+tag+'-CLIENT',technical:'QA117-'+tag+'-TECH'},number:null};
}
/** Фактический Next15 manifest имеет filename server/...; public source нормализуется до src/... только здесь. */
export function extractPreferenceAction117(manifestBytes,revision){
 need117(REV.test(revision??''),'K117_MANIFEST_REVISION_REQUIRED');const bytes=Buffer.from(manifestBytes);need117(bytes.length>0&&bytes.length<=4*1024*1024,'K117_MANIFEST_BYTES_LIMIT');let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw Error('K117_MANIFEST_JSON_REQUIRED');}
 need117(manifest?.node&&typeof manifest.node==='object'&&!Array.isArray(manifest.node),'K117_NODE_MANIFEST_REQUIRED');
 const matches=Object.entries(manifest.node).filter(([,entry])=>entry?.exportedName==='saveListPreference');need117(matches.length===1,'K117_UNIQUE_COMPILED_PREFERENCE_REQUIRED');
 const[id,entry]=matches[0];need117(/^[a-f0-9]{42}$/.test(id)&&entry.filename==='server/list-preferences-actions.ts'&&entry.workers&&entry.layer,'K117_COMPILED_SOURCE_ABI_MISMATCH');
 const routes=SEARCH117_ACTION_ROUTES.map(route=>{const worker=entry.workers[route];need117(worker&&typeof worker.moduleId==='string'&&/^[0-9]{1,12}$/.test(worker.moduleId)&&typeof worker.async==='boolean'&&entry.layer[route]==='action-browser','K117_COMPILED_WORKER_ABI_MISMATCH');return{route,moduleId:worker.moduleId,async:worker.async,layer:'action-browser'};});
 return{action:{id,exportedName:'saveListPreference',filename:'src/server/list-preferences-actions.ts',revision,manifestSha256:bytes117(bytes)},routes};
}
export function ownedQuery117(section,term,plan){need117(['projects','products'].includes(section),'K117_PREF_SECTION_INVALID');const terms=section==='projects'?[plan.number,plan.tokens.projectTitle,plan.tokens.client,plan.tokens.technical,plan.tokens.productTitle]:[plan.number+'.1',plan.tokens.productTitle,plan.tokens.client,plan.tokens.technical,plan.tokens.projectTitle];need117(ownTerm117(term,terms,plan.cohort===2),'K117_PREF_TERM_OUTSIDE_OWN');const params=new URLSearchParams({view:'kanban'});if(term)params.set('q',term);params.set(section==='projects'?'client':'project',encodeListFilterValue([section==='projects'?plan.ids.client:plan.ids.project]));params.set('active','0');return normalizeListQuery(section,params.toString());}
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

export function assertCurrentCertificate117(certificate,handoff,sources){need117(certificate?.namespace===handoff.namespace&&certificate.version===handoff.version&&certificate.kind==='current-browser-verification'&&certificate.runId===handoff.runId&&certificate.revision===handoff.revision&&certificate.handoffHash===digest117(handoff)&&certificate.originalPreSha256===handoff.originalPreSha256&&certificate.actorId===handoff.actor.id&&certificate.actionManifestSha256===handoff.action.manifestSha256&&certificate.verifierSourceSha256===sources['kanban-search-owned-fixtures.mjs']&&SHA.test(certificate.signature??''),'K117_CURRENT_PRODUCER_CERTIFICATE_MISMATCH');return certificate;}

// V1 остаётся историческим форматом; новые восемь строк имеют отдельный namespace.
export const COHORT163_ACTORS=['manager','assignedEngineer','foreignEngineer','accountant'];
const ACTOR_ROLES=['MANAGER','ENGINEER','ENGINEER','ACCOUNTANT'];
const COHORT_KEYS=[...COHORT163_ACTORS,'client','project','productA','productB'];
export function envelope117(input){return input.registry?{namespace:COHORT163_NAMESPACE,version:2,registrySha256:input.registrySha256}:{namespace:SEARCH117_NAMESPACE,version:1};}
export function validateCohortRegistry163(input){
 basic117(input);const r=input.registry;
 need117(r?.namespace===COHORT163_NAMESPACE&&r.version===2&&r.authorized===true&&r.runId===input.runId&&r.revision===input.revision,'K117_COHORT_REGISTRY_REQUIRED');
 need117(SHA.test(input.registrySha256??'')&&digest117(r)===input.registrySha256,'K117_ROOT_REGISTRY_DIGEST_REQUIRED');
 need117(r.ids&&Object.keys(r.ids).sort().join('|')===[...COHORT_KEYS].sort().join('|')&&COHORT_KEYS.every(key=>UUID.test(r.ids[key]??''))&&new Set(Object.values(r.ids)).size===8,'K117_EXACT_EIGHT_OWN_IDS_REQUIRED');
 need117(r.identity?.hostname==='crm-staging'&&r.identity.revision===input.revision&&r.identity.databaseVolume==='crm-staging_pgdata'&&SHA.test(r.identity.web??'')&&SHA.test(r.identity.database??'')&&/^sha256:[a-f0-9]{64}$/.test(r.identity.image??'')&&SHA.test(r.identity.outerW07Sha256??''),'K117_ROOT_ACTUAL_IDENTITY_REQUIRED');
 need117(SHA.test(r.sourceManifestDigest??'')&&SHA.test(r.catalogPolicySha256??'')&&r.scenarioId==='163.shared-cohort','K117_ROOT_SOURCE_CATALOG_REQUIRED');
 need117(Array.isArray(r.actionGrants)&&r.actionGrants.length<=8,'K117_FINITE_ACTION_GRANTS_REQUIRED');
 for(const g of r.actionGrants)need117(g.kind==='readonly-bell'&&COHORT163_ACTORS.includes(g.actor)&&g.exportedName==='getBellData'&&g.filename==='src/server/notifications/actions.ts'&&Array.isArray(g.paths)&&g.paths.length>0&&g.paths.length<=4&&g.paths.every(v=>v==='/projects'||v==='/products'||v==='/projects/'+r.ids.project),'K117_UNREVIEWED_ACTION_EFFECTS_REFUSED');
 return r;
}
export function cohortPlan163(input){
 const r=validateCohortRegistry163(input),tag=input.runId.replaceAll('-',''),token=suffix=>'QA163-'+tag+'-'+suffix;
 return{cohort:2,runId:input.runId,revision:input.revision,registrySha256:input.registrySha256,registry:r,
  ids:{actor:r.ids.manager,client:r.ids.client,project:r.ids.project,product:r.ids.productA},
  actors:COHORT163_ACTORS.map((key,index)=>({key,id:r.ids[key],roles:[ACTOR_ROLES[index]],email:'qa163-'+input.runId+'-'+key.toLowerCase()+'@invalid.test',name:token(key.toUpperCase())})),
  productIds:[r.ids.productA,r.ids.productB],passwordHash:'QA163_DISABLED_NOT_A_PASSWORD_HASH',
  tokens:{projectTitle:token('PROJECT'),productTitle:token('PRODUCT-A'),client:token('CLIENT'),technical:token('TECH')},productBTitle:token('PRODUCT-B'),number:null};
}
export function ownIds117(plan){return{User:plan.cohort===2?plan.actors.map(a=>a.id):[plan.ids.actor],Client:[plan.ids.client],Project:[plan.ids.project],Product:plan.cohort===2?[...plan.productIds]:[plan.ids.product]};}
export function actor117(plan,key='manager'){
 if(plan.cohort!==2){need117(key==='manager','K117_LEGACY_ACTOR_SCOPE');return{id:plan.ids.actor,roles:['MANAGER'],email:plan.email,name:plan.actorName};}
 const actor=plan.actors.find(a=>a.key===key);need117(actor,'K117_OWN_PROFILE_REQUIRED');return actor;
}
export function ownTerm117(term,terms,prefix=false){return typeof term==='string'&&(term===''||terms.includes(term)||prefix&&term.length>=1&&term.length<=100&&terms.some(value=>typeof value==='string'&&value.startsWith(term)));}
export function stateRows117(state,table){return Array.isArray(state[table])?state[table]:[state[table]];}

export function extractReadonlyActions163(manifestBytes,registry){
 const bytes=Buffer.from(manifestBytes),m=JSON.parse(bytes.toString('utf8'));
 return registry.actionGrants.map(g=>{const found=Object.entries(m.node??{}).filter(([,v])=>v?.exportedName===g.exportedName&&v.filename==='server/notifications/actions.ts');
  need117(found.length===1&&/^[a-f0-9]{42}$/.test(found[0][0]),'K117_COMPILED_READONLY_ACTION_REQUIRED');
  const [id,entry]=found[0];for(const pathname of g.paths){const route=pathname.startsWith('/projects/')?'app/(app)/projects/[id]/page':'app/(app)'+pathname+'/page';need117(entry.workers?.[route]&&entry.layer?.[route]==='action-browser','K117_COMPILED_READONLY_WORKER_REQUIRED');}
  return{...g,id,revision:registry.revision,manifestSha256:bytes117(bytes),args:[]};});
}

// Одна спецификация создаваемых строк для writer и cold проверок; денег/работ/файлов нет.
export function fixtureRows117(plan){
 need117(/^[1-9][0-9]{0,10}$/.test(plan.number??''),'K117_RESERVED_PROJECT_NUMBER_REQUIRED');
 const actors=plan.cohort===2?plan.actors:[actor117(plan)];
 return[...actors.map(a=>({model:'user',data:{id:a.id,email:a.email,name:a.name,passwordHash:plan.passwordHash,roles:a.roles,active:true,payScheme:'NONE'}})),
  {model:'client',data:{id:plan.ids.client,name:plan.tokens.client,phone:plan.cohort===2?'163':'117'}},
  {model:'project',data:{id:plan.ids.project,number:plan.number,numberInt:Number(plan.number),title:plan.tokens.projectTitle,stage:plan.cohort===2?'IN_WORK':'LEAD',clientId:plan.ids.client,managerId:plan.ids.actor,createdById:plan.ids.actor,currency:'BYN'}},
  ...ownIds117(plan).Product.map((id,index)=>({model:'product',data:{id,projectId:plan.ids.project,number:plan.number+'.'+(index+1),suffixInt:index+1,title:index?plan.productBTitle:plan.tokens.productTitle,description:plan.tokens.technical,status:plan.cohort===2?(index?'PRODUCTION':'PREPARATION'):'DRAFT',quantity:1,noModel:true,createdById:plan.ids.actor,...(index?{engineerId:actor117(plan,'assignedEngineer').id}:{})}}))];
}
