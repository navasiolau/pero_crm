import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {JournalReferenceDb} from '../src/server/changelog/reference-db';
import {resolveJournalEntries,type JournalStoredEntry} from '../src/server/changelog/resolver';
import {buildJournalPresentation} from '../src/server/changelog/presentation';
import type {Prisma} from '@prisma/client';

const emptyDb={$queryRaw:async()=>[]} as unknown as JournalReferenceDb;
const row=(patch:Partial<JournalStoredEntry>={}):JournalStoredEntry=>({id:'event',actorType:'user',actorId:'actor',actorName:'Имя на момент события',entity:'product',entityId:'product',action:'update',createdAt:new Date('2026-11-16T12:00:00Z'),presentation:null,searchText:null,...patch});

test('legacy receipt adapters compare business values and keep safe receipt metadata',async()=>{
 const source=row({entity:'orgSetting',entityId:'productPercentageDefaults',action:'percentage-defaults.update',
  oldValue:{revision:3,rates:{ENGINEERING:'4'}},newValue:{fingerprint:'fingerprint-public',password:'do-not-expose',result:{ok:true,kind:'saved',snapshot:{revision:4,rates:{ENGINEERING:'6'}},noOp:false,repeated:false}}});
 const original=JSON.stringify(source),[result]=await resolveJournalEntries(emptyDb,[source]);
 assert.deepEqual(result.presentation.changes.map(change=>[change.path,change.before,change.after]),[['rates.ENGINEERING','4','6']]);
 assert.equal(result.searchText.includes('fingerprint-public'),true);assert.equal(result.searchText.includes('do-not-expose'),false);
 assert.equal(JSON.stringify(result.presentation).includes('do-not-expose'),false);assert.equal(JSON.stringify(source),original);
});
test('backfill preserves explicit complete snapshots, labels, executor and known contexts',async()=>{
 const source=row({action:'kp.synchronize',newValue:{proposalId:'cp',name:'raw name'}});
 source.presentation=buildJournalPresentation(source,{actor:{type:'system',id:'system',name:'Система'},entity:{label:'Изделие 203.1'},
  before:{title:'Историческое полное название',quantity:2},after:{title:'Новое полное название',quantity:3},contexts:[{kind:'product',id:'product',label:'Изделие 203.1'}]});
 const before=JSON.stringify(source.presentation),[result]=await resolveJournalEntries(emptyDb,[source],true);
 assert.deepEqual(result.presentation.changes,(source.presentation as ReturnType<typeof buildJournalPresentation>).changes);
 assert.equal(result.presentation.entity.label,'Изделие 203.1');assert.equal(result.presentation.actor.type,'system');
 assert.equal(JSON.stringify(source.presentation),before);assert.equal(result.presentation.technical.id,source.id);
});
test('backfill fixes proven legacy automation and does not guess an ordinary status',async()=>{
 const proven=row({action:'kp.synchronize',newValue:{proposalId:'cp',title:'Кухня'}}),ambiguous=row({id:'ordinary',action:'status',field:'status',oldValue:'DRAFT',newValue:'PREPARATION'});
 proven.presentation=buildJournalPresentation(proven);ambiguous.presentation=buildJournalPresentation(ambiguous);
 const [first,second]=await resolveJournalEntries(emptyDb,[proven,ambiguous],true);
 assert.equal(first.presentation.actor.type,'system');assert.equal(first.presentation.initiator?.name,'Имя на момент события');
 assert.equal(second.presentation.actor.type,'user');assert.equal(proven.actorType,'user');
});
test('unknown old values remain unknown and missing historical bindings stay global',async()=>{
 const [entry]=await resolveJournalEntries(emptyDb,[row({entity:'task',entityId:'gone-task',oldValue:{revision:1},newValue:{title:'Новый заголовок'}})]);
 assert.equal(entry.presentation.contexts.length,0);
 const title=entry.presentation.changes.find(change=>change.path==='title');assert.equal(title?.beforeKnown,false);
 assert.equal(entry.presentation.changes.some(change=>change.path==='revision'),false);
});
test('missing v1 actor name resolves plainly with current provenance and no raw rewrite',async()=>{
 const db={$queryRaw:async(query:Prisma.Sql)=>query.sql.includes('"User"')?[{id:'actor',label:'Иван Иванов'}]:query.sql.includes('"Product"')?[{id:'product',label:'Изделие 203.1',number:'203.1'}]:[]} as unknown as JournalReferenceDb;
 const source=row({actorName:null});source.presentation=buildJournalPresentation(source);
 const original=JSON.stringify(source),[entry]=await resolveJournalEntries(db,[source],true);
 assert.equal(entry.presentation.actor.name,'Иван Иванов');assert.equal(entry.presentation.entity.label,'Изделие 203.1');
 assert.equal(entry.presentation.contexts[0].label,'Изделие 203.1');
 assert.deepEqual(entry.presentation.technical.referenceResolution,{entity:{source:'current',type:'product',id:'product',label:'Изделие 203.1'},actor:{source:'current',id:'actor',name:'Иван Иванов'}});
 assert.equal(JSON.stringify(source),original);assert.equal(source.actorName,null);
});
test('resolved diff reference names are plain and exact IDs and provenance remain searchable in details',async()=>{
 const db={$queryRaw:async(query:Prisma.Sql)=>query.sql.includes('"User"')?[{id:'engineer',label:'Инженер Иван'}]:[]} as unknown as JournalReferenceDb;
 const [entry]=await resolveJournalEntries(db,[row({oldValue:{engineerId:null},newValue:{engineerId:'engineer'}})]);
 assert.equal(entry.presentation.changes[0].after,'Инженер Иван');
 assert.deepEqual(entry.presentation.technical.references,[{path:'engineerId',side:'after',type:'user',id:'engineer',label:'Инженер Иван',source:'current'}]);
 assert.ok(entry.searchText.includes('engineer'));assert.equal(entry.presentation.changes[0].before,null);
});
