import type {JournalEntryInput,JournalPresentationHints} from './contract';
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Только пары action/schema, чей действующий writer однозначно является автоматическим следствием. */
export function legacyAutomationHints(entry:JournalEntryInput):JournalPresentationHints|null{
 if(entry.actorType!=='user')return null;
 const before=object(entry.oldValue),after=object(entry.newValue);if(!after)return null;
 const proposal=typeof after.proposalId==='string'&&after.proposalId.length>0;
 let reason:string|null=null;
 if(['project','product'].includes(entry.entity)&&entry.action==='kp.synchronize'&&proposal)reason='Автоматическое обновление из КП';
 if(entry.entity==='project'&&entry.action==='proposal.pricing.sync'&&proposal&&object(before?.project)&&Array.isArray(before?.products)&&object(after.project)&&Array.isArray(after.items))reason='Пересчёт стоимости проекта из КП';
 if(entry.entity==='product'&&entry.action==='kp.cover'&&proposal&&Object.hasOwn(after,'previousFileId')&&Object.hasOwn(after,'sketchFileId'))reason='Обновление изображения изделия из КП';
 if(entry.entity==='file'&&entry.action==='kp.retire'&&proposal&&Object.hasOwn(after,'sourceItemId')&&Object.hasOwn(after,'sourceMediaId')&&typeof after.retiredAt==='string')reason='Удаление устаревшего изображения из КП';
 if(entry.entity==='commercialProposal'&&entry.action==='client.synchronize'&&before&&Object.hasOwn(before,'clientId')&&Object.hasOwn(after,'clientId')&&typeof before.revision==='number'&&typeof after.revision==='number'&&typeof after.projectId==='string')reason='Синхронизация клиента КП с проектом';
 if(entry.entity==='product'&&entry.action==='number.change'&&entry.field==='number'&&typeof before?.number==='string'&&typeof after.number==='string'&&Object.hasOwn(before,'suffixInt')&&typeof after.suffixInt==='number')reason='Перенумерация изделий после изменения состава проекта';
 if(entry.entity==='product'&&entry.action==='initialPrice.capture'&&before?.initialPrice===null&&before.initialPriceCaptureEligible===true&&after.initialPriceCaptureEligible===false&&after.initialPrice!==null&&after.initialPrice!==undefined)reason='Автоматическая фиксация первоначальной цены изделия';
 if(entry.entity==='product'&&['percentage.firstCompletion','percentage.lateSettlement'].includes(entry.action)&&after.calculationVersion===4&&typeof after.kind==='string'&&typeof after.completionId==='string'&&typeof after.statusAtCompletion==='string')reason='Автоматическое начисление за завершение этапа изделия';
 if(entry.entity==='product'&&entry.action==='percentage.rateAdjust'&&typeof after.kind==='string'&&['oldRate','newRate','oldAmount','newAmount','delta'].every(key=>Object.hasOwn(after,key)))reason='Пересчёт начисления после изменения ставки';
 if(!reason)return null;
 return {actor:{type:'system',id:'system',name:'Система'},initiator:{id:entry.actorId,name:entry.actorName||'Имя не сохранено'},reason};
}
