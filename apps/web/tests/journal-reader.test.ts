import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {JournalPresentation} from '../src/server/changelog/contract';
import {normalizeJournalQuery} from '../src/server/changelog/query-contract';
import {readJournalPage,readJournalDetail,readJournalOptions,compareJournalRows,type JournalReadStore,type JournalResolvedEntry} from '../src/server/changelog/reader-core';

function event(id:number,patch:Partial<JournalPresentation>={}):JournalResolvedEntry{
 const presentation:JournalPresentation={version:1,kind:'event',actor:{type:'user',id:'u1',name:'Историческое имя'},
  entity:{type:'product',id:'p1',label:'Изделие 203.1'},contexts:[{kind:'product',id:'p1',label:'Изделие 203.1'}],
  action:{code:'update',label:'Изменение'},source:{code:'api',label:'API'},changes:[],links:[],technical:{},...patch};
 return {id:String(id).padStart(5,'0'),createdAt:new Date('2026-11-16T10:00:00Z'),presentation,searchText:`событие ${id} ${id===1?'текст '.repeat(100)+'ДАЛЁКИЙ_ХВОСТ 100%':'обычное'} API`};
}
function store(legacy:JournalResolvedEntry[],prepared:JournalResolvedEntry[]=[]):JournalReadStore{
 return {
  async pending(after,limit){return legacy.filter(e=>after===null||e.id>after).slice(0,limit);},
  async preparedCount(){return prepared.length;},
  async preparedRows(_query,limit,offset=0){return prepared.slice().reverse().slice(offset,offset+limit).map(e=>({id:e.id,createdAt:e.createdAt.toISOString(),actorName:e.presentation.actor.name,entityLabel:e.presentation.entity.label,actionLabel:e.presentation.action.label,changeCount:e.presentation.changes.length,hasChanges:e.presentation.changes.length>0}));},
  async find(id){return [...legacy,...prepared].find(e=>e.id===id)??null;},
  async preparedOptions(){return [];},async users(){return [{id:'u1',name:'Текущее имя'},{id:'inactive',name:'Неактивный'}];},
 };
}
test('full legacy scan searches after 200 rows and after 60 characters without truncation',async()=>{
 const entries=Array.from({length:501},(_,i)=>event(i+1));
 const page=await readJournalPage(store(entries),normalizeJournalQuery({q:'далёкий_хвост 100%'}));
 assert.equal(page.total,1);assert.equal(page.entries[0].id,'00001');
 assert.equal('presentation' in page.entries[0],false);
});
test('same-time pages merge canonical and pending records deterministically and clamp page',async()=>{
 const entries=Array.from({length:45},(_,i)=>event(i+1));
 const db=store(entries.slice(0,25),entries.slice(25));
 const first=await readJournalPage(db,normalizeJournalQuery({}));
 const second=await readJournalPage(db,normalizeJournalQuery({page:2}));
 const last=await readJournalPage(db,normalizeJournalQuery({page:999}));
 assert.equal(first.total,45);assert.equal(first.entries[0].id,'00045');assert.equal(first.entries.at(-1)?.id,'00026');
 assert.equal(second.entries[0].id,'00025');assert.equal(last.page,3);assert.equal(last.entries.length,5);
 assert.equal(new Set([...first.entries,...second.entries,...last.entries].map(e=>e.id)).size,45);
});
test('fully backfilled history reads only the requested SQL page',async()=>{
 const db=store([],Array.from({length:45},(_,i)=>event(i+1)));let requested:unknown;
 const read=db.preparedRows;db.preparedRows=async(...args)=>{requested=args.slice(1);return read(...args);};
 const page=await readJournalPage(db,normalizeJournalQuery({page:2}));
 assert.deepEqual(requested,[20,20]);assert.equal(page.entries[0].id,'00025');assert.equal(page.total,45);
});
test('mixed-case event IDs use the same case-sensitive tie-break as PostgreSQL C collation',()=>{
 const rows=['event-a','event-Z','event-A','event-z'].map(id=>({id,createdAt:'2026-11-16T00:00:00.000Z',actorName:'Один автор',entityLabel:'Изделие',actionLabel:'Изменение',changeCount:0,hasChanges:false}));
 assert.deepEqual(rows.sort(compareJournalRows({sort:'time',dir:'desc'})).map(row=>row.id),['event-z','event-a','event-Z','event-A']);
});
test('project scope excludes product ownership and detail cannot bypass scope or hidden events',async()=>{
 const product=event(1,{contexts:[{kind:'product',id:'p1',label:'Изделие 203.1'}],links:[{type:'project',id:'pr',label:'Проект 203'}]});
 const project=event(2,{entity:{type:'project',id:'pr',label:'Проект 203'},contexts:[{kind:'project',id:'pr',label:'Проект 203'}]});
 const receipt=event(3,{kind:'receipt'}),excluded=event(4,{kind:'excluded'}),unknown=event(5,{contexts:[]});
 const db=store([product,project,receipt,excluded,unknown]);
 assert.deepEqual((await readJournalPage(db,normalizeJournalQuery({scope:{kind:'project',id:'pr'}}))).entries.map(e=>e.id),['00002']);
 await assert.rejects(()=>readJournalDetail(db,'00001',{kind:'project',id:'pr'}),/не найдена/);
 await assert.rejects(()=>readJournalDetail(db,'00003',{kind:'global'}),/не найдена/);
 assert.equal((await readJournalPage(db,normalizeJournalQuery({}))).total,3);
 assert.equal((await readJournalDetail(db,'00001',{kind:'product',id:'p1'})).id,'00001');
});
test('explicit ownership transfer appears in both old and new feeds without parent fan-out',async()=>{
 const transfer=event(1,{entity:{type:'task',id:'task',label:'Задача'},contexts:[{kind:'project',id:'pr',label:'Проект 203'},{kind:'product',id:'p1',label:'Изделие 203.1'}]});
 const db=store([transfer]);
 for(const scope of [{kind:'project' as const,id:'pr'},{kind:'product' as const,id:'p1'}])assert.equal((await readJournalPage(db,normalizeJournalQuery({scope}))).total,1);
 assert.equal((await readJournalPage(db,normalizeJournalQuery({scope:{kind:'project',id:'other'}}))).total,0);
});
test('Moscow period, exact actor/entity and system filtering all apply before paging',async()=>{
 const user=event(1),system=event(2,{actor:{type:'system',id:'system',name:'Система'}});
 user.createdAt=new Date('2026-11-15T20:59:59.999Z');system.createdAt=new Date('2026-11-15T21:00:00.000Z');
 const db=store([user,system]);
 assert.equal((await readJournalPage(db,normalizeJournalQuery({from:'2026-11-16',to:'2026-11-16'}))).total,1);
 assert.equal((await readJournalPage(db,normalizeJournalQuery({actorId:'__system__',entity:'product'}))).entries[0].id,'00002');
 assert.equal((await readJournalPage(db,normalizeJournalQuery({actorId:'u1'}))).total,1);
 assert.equal((await readJournalPage(db,normalizeJournalQuery({entity:'project'}))).total,0);
});
test('filter options keep inactive and historical users without technical-only entities',async()=>{
 const db=store([event(1),event(2,{actor:{type:'user',id:'deleted',name:'Удалённый автор'}}),event(3,{kind:'receipt',entity:{type:'internal',id:'x',label:'internal'}})]);
 const options=await readJournalOptions(db,{kind:'global'});
 assert.ok(options.users.some(x=>x.id==='inactive'));
 assert.ok(options.users.some(x=>x.id==='deleted'&&x.label==='Удалённый автор'));
 assert.ok(options.users.some(x=>x.id==='u1'&&x.label.includes('Историческое имя')));
 assert.ok(options.users.some(x=>x.id==='__system__'&&x.label==='Система'));
 assert.equal(options.entities.some(x=>x.id==='internal'),false);
});
