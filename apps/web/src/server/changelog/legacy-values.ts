import type {JournalEntryInput,JournalChange} from './contract';
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const serviceFields=new Set(['fingerprint','requestFingerprint','uploadFingerprint','intentHash','operationId','clientMutationId','eventId','jobId','requestId','attempt','noOp','repeated','revision','calculationVersion']);

/** Служебные поля остаются в technical; они не являются изменением бизнес-значения. */
export function journalBusinessChanges(changes:JournalChange[]):JournalChange[]{
 return changes.filter(change=>!change.path.split('.').some(part=>serviceFields.has(part)));
}

/** Exact legacy receipt shapes; неизвестные форматы сохраняют исходное представление. */
export function legacyBusinessEntry(entry:JournalEntryInput):JournalEntryInput|null{
 const before=object(entry.oldValue),after=object(entry.newValue),result=object(after?.result);
 if(entry.entity==='orgSetting'&&entry.action==='percentage-defaults.update'&&before&&object(before.rates)&&object(result?.snapshot)){
  const snapshot=object(result?.snapshot)!;
  if(object(snapshot.rates))return {...entry,oldValue:{rates:before.rates},newValue:{rates:snapshot.rates}};
 }
 if(entry.entity==='product'&&entry.action==='percentage.patch'&&before&&Object.hasOwn(before,'value')&&result&&Object.hasOwn(result,'value')&&result.field===entry.field)return {...entry,oldValue:before.value,newValue:result.value};
 if(entry.entity==='product'&&entry.action==='percentage.rateAdjust'&&after&&['kind','oldRate','newRate','oldAmount','newAmount','delta'].every(key=>Object.hasOwn(after,key)))return {...entry,field:null,
  oldValue:{kind:after.kind,ratePercent:after.oldRate,amount:after.oldAmount},newValue:{kind:after.kind,ratePercent:after.newRate,amount:after.newAmount,delta:after.delta}};
 if(entry.entity==='payout'&&entry.action==='issue'&&entry.id?.startsWith('payout-issue:')&&after&&typeof after.payoutId==='string'&&Object.hasOwn(after,'fingerprint')){
  const business=Object.fromEntries(Object.entries(after).filter(([key])=>key!=='fingerprint'));
  return {...entry,oldValue:null,newValue:business};
 }
 if(['delete','soft-delete'].includes(entry.action)&&after&&(Object.hasOwn(after,'fingerprint')||Object.hasOwn(after,'requestFingerprint'))&&result)return {...entry,newValue:null};
 return null;
}
