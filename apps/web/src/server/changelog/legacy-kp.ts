import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import type {JournalEntryInput,JournalPresentation} from './contract';
import {buildJournalPresentation,sanitizeJournalValue} from './presentation';
import {journalActionLabel} from './labels';
import type {JournalStoredEntry} from './resolver';
import type {JournalReferenceDb} from './reference-db';

const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const object=(value:unknown)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function canonical(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(object(value))return `{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${canonical(record(value)[key])}`).join(',')}}`;
 return JSON.stringify(value)??'null';
}
export const legacyKpInnerId=(actorId:string,operationId:string)=>`kp:mutation:${createHash('sha256').update(`${actorId}\0${operationId}`).digest('hex')}`;
const apiLabels:Record<string,string>={'document.create':'Создание КП','document.save':'Изменение',pdf:'Запрос выпуска PDF','version.restore':'Восстановление версии',upload:'Загрузка изображения','client.create':'Создание клиента','contract.save':'Изменение договора','contract.generate':'Запрос выпуска договора'};

export function legacyJournalActionLabel(entry:JournalEntryInput):string{
 if(entry.action==='kp.api.command'){const kind=record(entry.newValue).kind;return typeof kind==='string'&&Object.hasOwn(apiLabels,kind)?apiLabels[kind]:'Неизвестная операция API';}
 const label=journalActionLabel(entry.action);
 return label==='Неизвестная операция'&&/^qa(?:[.:]|\d)/i.test(entry.entity)?'Служебная операция проверки':label;
}

export type LegacyKpJob={id:string;proposalId:string|null;createdById:string|null;kind:string;mediaId:string|null;fileId:string|null;itemId:string|null};
export type LegacyKpEvidence={logs:JournalStoredEntry[];jobs:LegacyKpJob[]};
const eligibleActions=new Set(['create','update','kp.api.command','kp.api.media']);
const relevant=(entry:JournalEntryInput)=>entry.entity==='commercialProposal'&&eligibleActions.has(entry.action);
function coreResult(entry:JournalStoredEntry){return record(record(entry.newValue).result);}
function matchingCore(log:JournalStoredEntry,proposalId:string,revision:number,actorId?:string,projectId?:unknown):boolean{
 const result=coreResult(log);
 return log.entity==='commercialProposal'&&log.entityId===proposalId&&log.actorType==='user'&&(!actorId||log.actorId===actorId)&&
  log.action==='kp.write.receipt'&&/^kp:mutation:[a-f0-9]{64}$/.test(log.id)&&result.ok===true&&result.proposalId===proposalId&&result.revision===revision&&
  (projectId===undefined||result.projectId===projectId)&&object(result.state)&&Array.isArray(record(result.state).items);
}
function rich(presentation:JournalPresentation):boolean{
 return !!presentation.technical.legacyKp||presentation.changes.some(change=>!['revision','projectId','itemIds','value'].includes(change.path));
}
function primaryProof(entry:JournalStoredEntry,evidence:LegacyKpEvidence){
 const revision=record(entry.newValue).revision,projectId=record(entry.newValue).projectId;if(!number(revision))return null;
 const candidates=evidence.logs.filter(log=>matchingCore(log,entry.entityId,revision,entry.actorId,projectId)&&coreResult(log).noOp===false);
 if(candidates.length!==1)return null;
 const receipt=candidates[0],result=coreResult(receipt),priorRevision=record(entry.oldValue).revision;
 const prior=number(priorRevision)?evidence.logs.filter(log=>matchingCore(log,entry.entityId,priorRevision,undefined,projectId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0):[];
 const distinct=new Map(prior.map(log=>[canonical(coreResult(log).state),log]));
 const before=distinct.size===1?[...distinct.values()][0]:null;
 return {receipt,result,before,beforeState:before?coreResult(before).state:null,beforeKnown:entry.action==='create'||before!==null};
}
function transport(entry:JournalStoredEntry){
 const value=record(entry.newValue);
 if(entry.actorType!=='user'||entry.action!=='kp.api.command'||!entry.id.startsWith('kp.api:')||!uuid(value.operationId)||!text(value.kind)||value.entityId!==entry.entityId||value.source!==entry.source||!object(value.result))return null;
 const binding={actorId:entry.actorId,source:value.source,tokenId:value.tokenId??null,operationId:value.operationId};
 if(entry.id!==`kp.api:${createHash('sha256').update(canonical(binding)).digest('hex')}`)return null;
 return {...value,operationId:value.operationId,kind:value.kind,result:record(value.result)};
}
function duplicate(presentation:JournalPresentation,primaryId:string,result:unknown):JournalPresentation{
 const reduced={...record(result)};delete reduced.state;
 return {...presentation,kind:'receipt',changes:[],technical:{...presentation.technical,duplicateOf:primaryId,operationResult:sanitizeJournalValue(reduced)}};
}

/** Доказательство строится по сохранённым receipt IDs/ревизиям, без чтения текущего КП. */
export function applyLegacyKpPresentation(entry:JournalStoredEntry,input:JournalPresentation,evidence:LegacyKpEvidence):JournalPresentation{
 let view:JournalPresentation={...input,action:{...input.action,label:legacyJournalActionLabel(entry)}};
 if(/^qa(?:[.:]|\d)/i.test(entry.entity)&&view.entity.label.startsWith('Объект'))view={...view,entity:{...view.entity,label:'Служебная проверка'}};
 if(!relevant(entry))return view;
 if(entry.action==='create'||entry.action==='update'){
  if(rich(view))return view;
  const proof=primaryProof(entry,evidence);if(!proof)return view;
  const rebuilt=buildJournalPresentation(entry,{actor:view.actor,initiator:view.initiator,reason:view.reason,entity:view.entity,contexts:view.contexts,links:view.links,kind:view.kind,
   before:proof.beforeState===null?null:{state:proof.beforeState},after:{state:proof.result.state},beforeKnown:proof.beforeKnown,afterKnown:true});
  return {...view,changes:rebuilt.changes,technical:{...view.technical,legacyKp:sanitizeJournalValue({afterReceiptId:proof.receipt.id,beforeReceiptId:proof.before?.id??null,
   beforeRevision:record(entry.oldValue).revision??null,afterRevision:proof.result.revision,afterState:proof.result.state,beforeKnown:proof.beforeKnown,
   originalBefore:entry.oldValue,originalAfter:entry.newValue})}};
 }
 if(entry.action==='kp.api.media'){
  const value=record(entry.newValue),job=evidence.jobs.find(job=>job.id===value.jobId&&job.proposalId===entry.entityId&&job.createdById===entry.actorId);
  const match=job?evidence.logs.filter(log=>log.action==='create'&&log.actorId===entry.actorId&&
   (job.kind==='UPLOAD_MEDIA'?log.entity==='proposalMedia'&&log.entityId===job.mediaId&&record(log.newValue).proposalId===entry.entityId:
    job.kind==='COPY_PRODUCT_MEDIA'&&log.entity==='file'&&log.entityId===job.fileId&&record(log.newValue).proposalId===entry.entityId&&record(log.newValue).sourceMediaId===job.mediaId&&record(log.newValue).sourceItemId===job.itemId)):[];
  if(match.length===1)return duplicate(view,match[0].id,value);
  return {...view,kind:'event',changes:[],reason:view.reason??'Сохранён запрос подготовки изображения; завершение не подтверждено этой записью.',technical:{...view.technical,operationResult:sanitizeJournalValue(value)}};
 }
 const command=transport(entry);
 if(!command)return view;
 const result=command.result;
 view={...view,kind:'event',changes:[],reason:view.reason??'Историческая запись хранит результат операции; сравнение до и после не сохранялось.',
  technical:{...view.technical,operationKind:command.kind,operationResult:sanitizeJournalValue(result)}};
 if(command.kind==='document.create'||command.kind==='document.save'){
  const inner=evidence.logs.find(log=>log.id===legacyKpInnerId(entry.actorId,command.operationId));
  if(!inner||!number(result.revision)||!matchingCore(inner,entry.entityId,result.revision,entry.actorId,record(result.project).id??result.projectId)||!object(result.state)||canonical(result.state)!==canonical(coreResult(inner).state))return view;
  if(coreResult(inner).noOp===true)return duplicate(view,inner.id,result);
  const primaries=evidence.logs.filter(log=>log.entity==='commercialProposal'&&log.entityId===entry.entityId&&log.actorId===entry.actorId&&
   log.action===(command.kind==='document.create'?'create':'update')&&record(log.newValue).revision===result.revision);
  if(primaries.length!==1)return view;
  const proof=primaryProof(primaries[0],evidence);if(!proof||proof.receipt.id!==inner.id)return view;
  return duplicate(view,primaries[0].id,result);
 }
 if(command.kind==='pdf'){
  const match=evidence.logs.find(log=>log.id===`kp-pdf-request:${result.id}`&&log.entity==='commercialProposal'&&log.entityId===entry.entityId&&log.actorId===entry.actorId&&log.action==='pdf.request'&&record(log.newValue).jobId===result.id);
  return match?duplicate(view,match.id,result):view;
 }
 if(command.kind==='version.restore'){
  const match=evidence.logs.find(log=>log.id===`kp.restore:${command.operationId}`&&log.entity==='commercialProposal'&&log.entityId===entry.entityId&&log.actorId===entry.actorId&&log.action==='version.restore'&&record(log.newValue).revision===result.revision);
  return match?duplicate(view,match.id,result):view;
 }
 if(command.kind==='upload'||command.kind==='client.create'){
  const entity=command.kind==='upload'?'proposalMedia':'client',id=command.kind==='upload'?result.mediaId:result.id;
  const match=evidence.logs.filter(log=>log.entity===entity&&log.entityId===id&&log.actorId===entry.actorId&&log.action==='create'&&
   (entity!=='proposalMedia'||record(log.newValue).proposalId===entry.entityId));
  // У старого client.create основной audit мог быть неполным; полный API snapshot не скрывается.
  if(entity==='client')return {...view,entity:{type:'client',id:text(id)?id:entry.entityId,label:text(result.label)?result.label:'Клиент'},contexts:[]};
  return match.length===1?duplicate(view,match[0].id,result):view;
 }
 return view;
}

export async function loadLegacyKpEvidence(db:JournalReferenceDb,rows:JournalStoredEntry[]):Promise<LegacyKpEvidence>{
 const candidates=rows.filter(relevant);if(!candidates.length)return {logs:[],jobs:[]};
 const ids=new Set(candidates.map(row=>row.entityId)),revisions=new Set<string>(),exactIds=new Set<string>(),jobIds=new Set<string>();
 for(const row of candidates){
  const value=record(row.newValue),result=record(value.result);
  for(const n of [value.revision,record(row.oldValue).revision,result.revision])if(number(n)){revisions.add(String(n));if(n>0)revisions.add(String(n-1));}
  if(uuid(value.operationId)){exactIds.add(legacyKpInnerId(row.actorId,value.operationId));exactIds.add(`kp.restore:${value.operationId}`);}
  if(value.kind==='pdf'&&text(result.id))exactIds.add(`kp-pdf-request:${result.id}`);
  if(value.kind==='upload'&&text(result.mediaId))ids.add(result.mediaId);
  if(value.kind==='client.create'&&text(result.id))ids.add(result.id);
  if(row.action==='kp.api.media'&&text(value.jobId))jobIds.add(value.jobId);
 }
 const jobs=jobIds.size?await db.$queryRaw<LegacyKpJob[]>(Prisma.sql`SELECT id,"proposalId","createdById",kind::text AS kind,payload->>'mediaId' AS "mediaId",payload->>'fileId' AS "fileId",payload->>'itemId' AS "itemId" FROM "ProposalJob" WHERE id IN (${Prisma.join([...jobIds])})`):[];
 for(const job of jobs){if(job.mediaId)ids.add(job.mediaId);if(job.fileId)ids.add(job.fileId);}
 const requested=Prisma.sql`c."entityId" IN (${Prisma.join([...ids])})`;
 const revisionPredicate=revisions.size?Prisma.sql`(c."newValue"->>'revision' IN (${Prisma.join([...revisions])}) OR c."newValue" #>> '{result,revision}' IN (${Prisma.join([...revisions])}))`:Prisma.sql`FALSE`;
 const logs=await db.$queryRaw<JournalStoredEntry[]>(Prisma.sql`SELECT c.* FROM "ChangeLog" c WHERE
  ${exactIds.size?Prisma.sql`c.id IN (${Prisma.join([...exactIds])}) OR`:Prisma.empty}
  (${requested} AND ((c.entity='commercialProposal' AND c.action IN ('create','update','kp.write.receipt') AND ${revisionPredicate})
   OR (c.entity IN ('proposalMedia','file','client') AND c.action='create')))`);
 return {logs,jobs};
}
