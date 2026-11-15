import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import type {JournalEntryInput,JournalPresentationHints} from '../../src/server/changelog/contract';
import {buildJournalPresentation,buildJournalSearchText} from '../../src/server/changelog/presentation';
import {normalizeJournalQuery} from '../../src/server/changelog/query-contract';
import {readJournalPage,readJournalDetail} from '../../src/server/changelog/reader-core';
import {createJournalReadStore} from '../../src/server/changelog/sql-store';
import {backfillJournalBatch,readJournalDatabaseIdentity} from '../../src/server/changelog/backfill';
import {assertJournalBackfillIdentity,type JournalBackfillTarget} from '../../src/server/changelog/backfill-target';

/** Только reviewed root runner: свои ChangeLog fixtures и backfill откатываются одной транзакцией. */
export async function runJournalQueryNative(db:PrismaClient,target:JournalBackfillTarget){
 assertJournalBackfillIdentity(target,await readJournalDatabaseIdentity(db));
 const runId=randomUUID(),prefix=`journal-native-${runId}`,productId=`${prefix}-product`,projectId=`${prefix}-project`,actorId=`${prefix}-actor`;
 const createdAt=new Date('2096-11-15T21:00:00.000Z'),ids:string[]=[];
 const sentinel=new Error('JOURNAL_NATIVE_ROLLBACK'),state:{receipt:Record<string,unknown>|null}={receipt:null};
 try{await db.$transaction(async tx=>{
  assertJournalBackfillIdentity(target,await readJournalDatabaseIdentity(tx));
  async function create(suffix:string,patch:Partial<JournalEntryInput>={},prepared=false,generatedId=false,hints:JournalPresentationHints={}){
   const entry:JournalEntryInput={...(!generatedId?{id:`${prefix}:${suffix}`}:{ }),actorType:'user',actorId,actorName:'QA Автор',entity:'product',entityId:productId,action:'update',source:'api',createdAt,
    oldValue:{description:'Прежнее значение'},newValue:{description:`${prefix} `+'полное значение '.repeat(25)+(suffix==='0000'?'Уникальный_хвост 100%\\"цитата"':''),marker:prefix},...patch};
   const presentation=buildJournalPresentation(entry,hints);
   const row=await tx.changeLog.create({data:{...entry,source:entry.source??'web',createdAt:entry.createdAt?new Date(entry.createdAt):undefined,
    oldValue:entry.oldValue===null?Prisma.JsonNull:entry.oldValue as Prisma.InputJsonValue,newValue:entry.newValue===null?Prisma.JsonNull:entry.newValue as Prisma.InputJsonValue,
    ...(prepared?{presentation:JSON.parse(JSON.stringify(presentation)) as Prisma.InputJsonValue,searchText:buildJournalSearchText(entry,presentation)}:{})}});
   ids.push(row.id);return row.id;
  }
  for(let index=0;index<205;index++)await create(String(index).padStart(4,'0'),{},index%2===1);
  await create('project',{entity:'project',entityId:projectId},true);
  await create('foreign',{entityId:`${prefix}-foreign`},true);
  await create('system',{action:'kp.synchronize',newValue:{proposalId:`${prefix}-cp`,marker:prefix}});
  await create('before',{createdAt:new Date('2096-11-15T20:59:59.999Z')});
  await create('after',{createdAt:new Date('2096-11-16T21:00:00.000Z')});
  const secretId=await create('secret',{newValue:{marker:prefix,password:'never-search-this-secret-value'}},true);
  const generatedId=await create('generated',{},true,true);
  const transferId=await create('transfer',{entity:'task',entityId:`${prefix}-task`},true,false,{contexts:[
   {kind:'project',id:`${prefix}-transfer-project`,label:'QA проект'},
   {kind:'product',id:`${prefix}-transfer-product`,label:'QA изделие'},
  ],links:[{type:'project',id:projectId,label:'Справочная связь не является контекстом'}]});
  const malformedId=await create('malformed',{entityId:`${prefix}-malformed-product`,newValue:{number:'999.1',marker:prefix}},true);
  await tx.changeLog.update({where:{id:malformedId},data:{presentation:{version:1,kind:'event',actor:{},entity:{type:'product',id:'wrong',label:'Неверное представление'},
   action:{code:'update',label:'Изменение'},source:{code:'api',label:'API'},changes:[{path:7,label:'Неверное поле',before:null,after:null,beforeKnown:null,afterKnown:true}],
   contexts:[{kind:'project',id:projectId}],links:[{type:'project',id:projectId}],technical:{}}}});
  const store=createJournalReadStore(tx),query=normalizeJournalQuery({scope:{kind:'product',id:productId},from:'2096-11-16',to:'2096-11-16',pageSize:20});
  const first=await readJournalPage(store,query);assert.equal(first.total,208);
  const found=await readJournalPage(store,{...query,q:'уникальный_хвост 100%\\"цитата"'});assert.equal(found.total,1);assert.equal(found.entries[0].id,`${prefix}:0000`);
  assert.equal((await readJournalPage(store,{...query,q:'never-search-this-secret-value'})).total,0);
  assert.equal((await readJournalPage(store,{...query,q:'API'})).total,208);
  assert.equal((await readJournalPage(store,{...query,q:generatedId})).total,1);
  assert.equal((await readJournalDetail(store,generatedId,query.scope)).presentation.technical.id,generatedId);
  assert.equal(JSON.stringify(await readJournalDetail(store,secretId,query.scope)).includes('never-search-this-secret-value'),false);
  assert.equal((await readJournalPage(store,{...query,actorId:'__system__'})).total,1);
  assert.equal((await readJournalPage(store,{...query,actorId})).total,207);
  assert.equal((await readJournalPage(store,{...query,scope:{kind:'project',id:projectId}})).total,1);
  const malformed=await readJournalPage(store,{...query,scope:{kind:'product',id:`${prefix}-malformed-product`}});
  assert.equal(malformed.total,1);assert.equal(malformed.entries[0].actorName,'QA Автор');assert.equal(malformed.entries[0].entityLabel,'Изделие 999.1');
  assert.equal((await readJournalDetail(store,malformedId,{kind:'product',id:`${prefix}-malformed-product`})).presentation.actor.name,'QA Автор');
  for(const scope of [{kind:'project' as const,id:`${prefix}-transfer-project`},{kind:'product' as const,id:`${prefix}-transfer-product`}])assert.equal((await readJournalDetail(store,transferId,scope)).id,transferId);
  await assert.rejects(()=>readJournalDetail(store,transferId,{kind:'project',id:projectId}),/не найдена/);
  await assert.rejects(()=>readJournalDetail(store,`${prefix}:0000`,{kind:'project',id:projectId}),/не найдена/);
  const allIds:string[]=[];
  for(let page=1;page<=Math.ceil(first.total/20);page++)allIds.push(...(await readJournalPage(store,{...query,page})).entries.map(entry=>entry.id));
  assert.equal(allIds.length,208);assert.equal(new Set(allIds).size,208);
  const raw=()=>tx.$queryRaw<{id:string;digest:string}[]>(Prisma.sql`SELECT c.id,md5((to_jsonb(c)-'presentation'-'searchText')::text) AS digest FROM "ChangeLog" c WHERE c.id IN (${Prisma.join(ids)}) ORDER BY c.id`);
  const before=await raw();
  const check=await backfillJournalBatch(tx,{target,mode:'check',batchSize:70,onlyIds:ids});assert.equal(check.updated,0);assert.equal(check.scanned,70);
  let cursor:string|null=null,updated=0,remaining=ids.length;
  while(remaining){const result=await backfillJournalBatch(tx,{target,mode:'apply',batchSize:70,afterId:cursor,onlyIds:ids});assert.equal(result.rawVerified,result.updated);updated+=result.updated;remaining=result.remaining;cursor=result.nextAfterId;}
  assert.equal(updated,ids.length);assert.deepEqual(await raw(),before);
  const repeated=await backfillJournalBatch(tx,{target,mode:'apply',batchSize:70,onlyIds:ids});assert.equal(repeated.updated,0);assert.equal(repeated.remaining,0);
  const after=await readJournalPage(store,query);assert.deepEqual(after,first);
  assert.equal((await readJournalPage(store,{...query,q:'уникальный_хвост 100%\\"цитата"'})).total,1);
  state.receipt={runId,fixtureCount:ids.length,matched:208,rawVerified:updated,repeatUpdated:0,longSearch:true,scope:true,system:true,dates:true,secretExcluded:true,autogeneratedId:true,paginationUnique:true,malformedFallback:true};
  throw sentinel;
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10_000,timeout:120_000});}catch(error){if(error!==sentinel)throw error;}
 assert.equal(await db.changeLog.count({where:{id:{in:ids}}}),0);
 if(!state.receipt)throw Error('JOURNAL_NATIVE_INCOMPLETE');
 return {...state.receipt,rolledBack:true,remainingFixtures:0};
}
