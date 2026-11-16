import type {JournalEntryInput,JournalPresentation,JournalValue} from './contract';
import {buildJournalPresentation,buildJournalSearchText,parseJournalPresentation,sanitizeJournalValue} from './presentation';
import {journalEntityLabel} from './labels';
import {legacyAutomationHints} from './legacy-automation';
import {legacyBusinessEntry,journalBusinessChanges} from './legacy-values';
import {deriveLegacyJournalHints,legacyReferenceOrigins,journalReferenceFieldType,referenceKey} from './reference-context';
import {loadJournalReferences,type JournalReferenceDb} from './reference-db';
import type {JournalResolvedEntry} from './reader-core';
import {applyLegacyKpPresentation,loadLegacyKpEvidence} from './legacy-kp';

export type JournalStoredEntry=JournalEntryInput&{id:string;createdAt:Date;presentation:unknown;searchText:string|null};

function withIdentity(presentation:JournalPresentation,entry:JournalStoredEntry):JournalPresentation{
 return {...presentation,technical:{...presentation.technical,id:entry.id,createdAt:entry.createdAt.toISOString()}};
}

export async function resolveJournalEntries(db:JournalReferenceDb,rows:JournalStoredEntry[],enrichStored=false):Promise<JournalResolvedEntry[]>{
 const legacy=rows.filter(row=>enrichStored||!parseJournalPresentation(row.presentation));
 const references=legacy.length?await loadJournalReferences(db,legacy):new Map();
 const kpEvidence=await loadLegacyKpEvidence(db,rows);
 return rows.map(entry=>{
  let presentation=parseJournalPresentation(entry.presentation);
  const generated=buildJournalPresentation(entry);
  const adaptValues=!presentation||enrichStored&&JSON.stringify(presentation.changes)===JSON.stringify(generated.changes);
  const hints=deriveLegacyJournalHints(entry,references),origins=legacyReferenceOrigins(entry,references),appliedOrigins:Record<string,JournalValue>={};
  if(!presentation){
   presentation=buildJournalPresentation(entry,{...hints,...legacyAutomationHints(entry)});
   Object.assign(appliedOrigins,origins);
  }else if(enrichStored){
   const resolveEntity=[journalEntityLabel(entry.entity),`${journalEntityLabel(entry.entity)} (название не сохранено)`].includes(presentation.entity.label)&&hints.entity?.label;
   const resolveActor=presentation.actor.type==='user'&&presentation.actor.id===entry.actorId&&presentation.actor.name==='Имя не сохранено'&&hints.actor;
   presentation={...presentation,
    ...(presentation.contexts.length===0&&hints.contexts?.length?{contexts:hints.contexts}:{}),
    ...(resolveEntity?{entity:{...presentation.entity,...hints.entity}}:{}),...(resolveActor?{actor:hints.actor!}:{}),
   };
   if(resolveEntity)presentation={...presentation,contexts:presentation.contexts.map(context=>{
    const resolved=hints.contexts?.find(value=>value.kind===context.kind&&value.id===context.id);
    return resolved&&context.id===entry.entityId&&[journalEntityLabel(entry.entity),`${journalEntityLabel(entry.entity)} (название не сохранено)`].includes(context.label)?{...context,label:resolved.label}:context;
   })};
   if(resolveEntity&&origins.entity)appliedOrigins.entity=origins.entity;
   if(resolveActor&&origins.actor)appliedOrigins.actor=origins.actor;
   const automation=legacyAutomationHints(entry);
   if(automation?.actor&&presentation.actor.type==='user'&&presentation.actor.id===entry.actorId)presentation={...presentation,
    actor:automation.actor,...(!presentation.initiator&&automation.initiator?{initiator:automation.initiator}:{}),...(!presentation.reason&&automation.reason?{reason:automation.reason}:{})};
  }
  if(adaptValues){
   const business=legacyBusinessEntry(entry);
   presentation={...presentation,changes:journalBusinessChanges(business?buildJournalPresentation(business).changes:presentation.changes),
    ...(business?{technical:{...presentation.technical,receipt:sanitizeJournalValue({oldValue:entry.oldValue,newValue:entry.newValue})}}:{})};
   const resolvedReferences:JournalValue[]=[];
   presentation={...presentation,changes:presentation.changes.map(change=>{
    const type=journalReferenceFieldType(change.path.split('.').at(-1)??'');if(!type)return change;
    function label(value:JournalValue,side:'before'|'after'):JournalValue{
     const known=typeof value==='string'?references.get(referenceKey(type!,value)):undefined;
     if(!known)return value;
     resolvedReferences.push({path:change.path,side,type:type!,id:value as string,label:known.label,source:'current'});
     return known.label;
    }
    return {...change,before:label(change.before,'before'),after:label(change.after,'after')};
   })};
   if(resolvedReferences.length)presentation={...presentation,technical:{...presentation.technical,references:resolvedReferences}};
  }
  if(presentation.initiator?.name==='Имя не сохранено'&&hints.actor&&presentation.initiator.id===hints.actor.id){
   presentation={...presentation,initiator:{id:hints.actor.id,name:hints.actor.name}};
   if(origins.actor)appliedOrigins.initiator=origins.actor;
  }
  if(Object.keys(appliedOrigins).length){
   const prior=presentation.technical.referenceResolution;
   const saved=prior!==null&&typeof prior==='object'&&!Array.isArray(prior)?prior:{};
   presentation={...presentation,technical:{...presentation.technical,referenceResolution:{...saved,...appliedOrigins}}};
  }
  presentation=applyLegacyKpPresentation(entry,presentation,kpEvidence);
  presentation=withIdentity(presentation,entry);
  const safe=parseJournalPresentation(presentation);if(!safe)throw Error('JOURNAL_RESOLUTION_INVALID');presentation=safe;
  return {id:entry.id,createdAt:entry.createdAt,presentation,searchText:buildJournalSearchText(entry,presentation)};
 });
}
