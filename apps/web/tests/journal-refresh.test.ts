import assert from 'node:assert/strict';
import {test} from 'node:test';
import {refreshJournalPresentation} from '../src/server/changelog/refresh';
import {buildJournalPresentation} from '../src/server/changelog/presentation';
import type {JournalEntryInput,JournalPresentation} from '../src/server/changelog/contract';

const entry:JournalEntryInput={id:'event',actorType:'user',actorId:'u',actorName:'Старое имя',entity:'product',entityId:'p',action:'update',source:'api',oldValue:{title:'До'},newValue:{title:'После'}};
test('forced derived refresh updates translations without replacing snapshot names, values or known flags',()=>{
 const original=buildJournalPresentation(entry,{entity:{label:'Изделие 203.1'},before:{title:'Сохранённое до',engineerId:'Сохранённое имя'},after:{title:'Сохранённое после',engineerId:'Другое имя'}});
 original.action.label='Операция';original.source.label='old source';original.changes.forEach(change=>change.label='old field');
 const baseline=structuredClone(original),refreshed=refreshJournalPresentation(entry,original);
 assert.equal(refreshed.action.label,'Изменение');assert.notEqual(refreshed.source.label,'old source');
 assert.equal(refreshed.entity.label,'Изделие 203.1');assert.deepEqual(refreshed.actor,baseline.actor);assert.deepEqual(refreshed.contexts,baseline.contexts);
 const facts=(value:JournalPresentation)=>value.changes.map(change=>({path:change.path,before:change.before,after:change.after,beforeKnown:change.beforeKnown,afterKnown:change.afterKnown}));
 assert.deepEqual(facts(refreshed),facts(baseline));
 assert.deepEqual(original,baseline);assert.deepEqual(refreshJournalPresentation(entry,refreshed),refreshed);
});
test('unknown before is not reconstructed during refresh and explicit API token snapshots are preserved',()=>{
 const api:JournalEntryInput={...entry,entity:'apiToken',entityId:'api-id',oldValue:null,newValue:{name:'Ключ',scopes:['read'],token:'credential-secret'}};
 const original:JournalPresentation={...buildJournalPresentation(api),changes:[{path:'name',label:'Название',before:null,after:'Снимок имени ключа',beforeKnown:false,afterKnown:true}]};
 const refreshed=refreshJournalPresentation(api,original);
 assert.equal(refreshed.changes[0].beforeKnown,false);assert.equal(refreshed.changes[0].after,'Снимок имени ключа');
 assert.equal(JSON.stringify(refreshed).includes('credential-secret'),false);
});
