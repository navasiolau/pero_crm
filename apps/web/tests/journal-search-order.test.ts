import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {JournalEntryInput,JournalPresentation} from '../src/server/changelog/contract';
import {buildJournalPresentation,buildJournalSearchText} from '../src/server/changelog/presentation';

/** JSONB упорядочивает ключи объектов по длине и байтам; порядок элементов массивов сохраняется. */
function jsonbRoundTrip(value:unknown):unknown{
 const parsed:unknown=JSON.parse(JSON.stringify(value));
 function reorder(node:unknown):unknown{
  if(Array.isArray(node))return node.map(reorder);
  if(node!==null&&typeof node==='object'){
   const data=node as Record<string,unknown>;
   const keys=Object.keys(data).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b)));
   return Object.fromEntries(keys.map(key=>[key,reorder(data[key])]));
  }
  return node;
 }
 return reorder(parsed);
}

test('searchText is byte-stable across JSONB round trips and nested object key order',()=>{
 const longText='Полный текст '.repeat(70)+'первая строка\n"конечная строка"';
 const input:JournalEntryInput={id:'event-order',actorType:'user',actorId:'actor',actorName:'Историческое имя',entity:'commercialProposal',entityId:'proposal',action:'update',source:'api',createdAt:new Date('2026-11-16T10:00:00Z'),
  oldValue:{revision:1,metadata:{longProperty:'старое',a:'краткое'}},newValue:{revision:2,items:[{name:'Шкаф',id:'item',description:longText}],metadata:{longProperty:'новое',a:'краткое'}}};
 const view=buildJournalPresentation(input);
 view.technical.legacyKp={afterReceiptId:'receipt-after',beforeReceiptId:'receipt-before',beforeRevision:1,afterRevision:2,
  afterState:{items:[{name:'Шкаф',id:'item',description:longText}],notes:'Дополнительный сохранённый текст'},beforeKnown:true};
 const originalInput=structuredClone(input),originalView=structuredClone(view);
 const storedInput=jsonbRoundTrip(input) as JournalEntryInput,storedView=jsonbRoundTrip(view) as JournalPresentation;
 const before=buildJournalSearchText(input,view),after=buildJournalSearchText(storedInput,storedView);
 assert.deepEqual(new Set(before.split('\n')),new Set(after.split('\n')),'Фактические поисковые значения не изменились');
 assert.equal(before,after,'Повтор refresh не должен переписывать индекс из-за порядка ключей JSONB');
 assert.ok(after.includes(longText),'Многострочное значение должно оставаться полным');
 assert.equal(after,buildJournalSearchText(storedInput,jsonbRoundTrip(storedView) as JournalPresentation));
 assert.deepEqual(input,originalInput);assert.deepEqual(view,originalView);
});
