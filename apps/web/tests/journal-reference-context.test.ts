import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {JournalEntryInput} from '../src/server/changelog/contract';
import {deriveLegacyJournalHints,referenceKey,type JournalReferenceMap} from '../src/server/changelog/reference-context';

const entry=(input:Partial<JournalEntryInput>):JournalEntryInput=>({actorType:'user',actorId:'author',entity:'task',entityId:'task1',action:'update',createdAt:new Date('2026-11-16'),...input});
const refs:JournalReferenceMap=new Map([
 [referenceKey('task','task1'),{type:'task',id:'task1',label:'Задача текущая',projectId:'project',productId:'different',ownership:'mutable'}],
 [referenceKey('project','project'),{type:'project',id:'project',label:'Проект 203'}],
 [referenceKey('product','product'),{type:'product',id:'product',label:'Изделие 203.1'}],
]);
test('mutable current task owner is never used as its historical owner',()=>{
 const hints=deriveLegacyJournalHints(entry({oldValue:{title:'Старое'},newValue:{title:'Новое'}}),refs);
 assert.equal(hints.contexts,undefined);
 assert.equal(hints.entity?.label,'Задача Новое');
});
test('explicit snapshot and deletion receipt context remain authoritative',()=>{
 const hints=deriveLegacyJournalHints(entry({entity:'file',entityId:'deleted',oldValue:{fileName:'Длинное имя.b3d'},newValue:{context:{projectId:'project',productId:'product'}}}),refs);
 assert.deepEqual(hints.contexts?.map(x=>[x.kind,x.id]),[['product','product']]);
 const common=deriveLegacyJournalHints(entry({newValue:{projectId:'project',productId:null}}),refs);
 assert.deepEqual(common.contexts?.map(x=>[x.kind,x.id]),[['project','project']]);
});
test('project IDs alone are insufficient for potentially product-owned records',()=>{
 assert.equal(deriveLegacyJournalHints(entry({newValue:{projectId:'project'}}),refs).contexts,undefined);
 assert.equal(deriveLegacyJournalHints(entry({entity:'payment',newValue:{projectId:'project'}}),refs).contexts?.[0].kind,'project');
});
test('deleted projects and products retain their own stable identity without lookup',()=>{
 const result=deriveLegacyJournalHints(entry({entity:'product',entityId:'gone',oldValue:{number:'203.1'}}),new Map());
 assert.equal(result.entity?.label,'Изделие 203.1');assert.equal(result.contexts?.[0].id,'gone');
 assert.equal(result.contexts?.[0].href,'/products/gone');
});
