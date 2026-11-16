import type {JournalEntryInput,JournalPresentation} from './contract';
import {buildJournalPresentation,classifyJournalEntry,formatJournalDisplayValue,parseJournalPresentation} from './presentation';
import {journalActionLabel,journalFieldLabel,journalSourceLabel} from './labels';

const object=(value:unknown)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function collapsedApiToken(entry:JournalEntryInput,presentation:JournalPresentation):boolean{
 return entry.entity==='apiToken'&&(object(entry.oldValue)||object(entry.newValue))&&presentation.changes.length===1&&presentation.changes[0].path==='value'&&
  [presentation.changes[0].before,presentation.changes[0].after].some(value=>value==='[скрыто]');
}

/** Обновляются только производные подписи; сохранённые человеческие снимки и known-flags остаются фактами. */
export function refreshJournalPresentation(entry:JournalEntryInput,input:JournalPresentation):JournalPresentation{
 let presentation=input;
 if(collapsedApiToken(entry,presentation)){
  const repaired=buildJournalPresentation(entry,{actor:presentation.actor,initiator:presentation.initiator,reason:presentation.reason,
   entity:presentation.entity,contexts:presentation.contexts,links:presentation.links,kind:presentation.kind});
  // До внедрения исправленного formatter №228 ничего не «восстанавливаем» из текущих объектов.
  if(!collapsedApiToken(entry,repaired))presentation={...presentation,changes:repaired.changes,
   technical:{...presentation.technical,normalizationRepair:'api-token-object-root'}};
 }
 const classification=classifyJournalEntry(entry);
 const explicitLabels=new Set(Array.isArray(presentation.technical.explicitFieldLabels)?presentation.technical.explicitFieldLabels.filter((path):path is string=>typeof path==='string'):[]);
 const result:JournalPresentation={...presentation,kind:classification==='event'?presentation.kind:classification,
  action:{...presentation.action,label:journalActionLabel(presentation.action.code)},source:{...presentation.source,label:journalSourceLabel(presentation.source.code)},
  changes:presentation.changes.map(change=>({...change,label:explicitLabels.has(change.path)?change.label:journalFieldLabel(change.path),
   before:formatJournalDisplayValue(change.before,change.path,presentation.entity.type),after:formatJournalDisplayValue(change.after,change.path,presentation.entity.type)})),
 };
 const safe=parseJournalPresentation(result);if(!safe)throw Error('JOURNAL_REFRESH_INVALID');return safe;
}
