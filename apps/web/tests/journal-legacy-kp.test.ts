import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {resolveJournalEntries,type JournalStoredEntry} from '../src/server/changelog/resolver';
import {buildJournalPresentation} from '../src/server/changelog/presentation';
import {legacyKpInnerId,legacyJournalActionLabel} from '../src/server/changelog/legacy-kp';
import type {JournalReferenceDb} from '../src/server/changelog/reference-db';
import type {Prisma} from '@prisma/client';

const op='a0000000-0000-4000-8000-000000000001',priorOp='a0000000-0000-4000-8000-000000000002';
const raw=(patch:Partial<JournalStoredEntry>):JournalStoredEntry=>({id:'business',actorType:'user',actorId:'actor',actorName:'Снимок имени',source:'api',entity:'commercialProposal',entityId:'proposal',action:'update',createdAt:new Date('2026-11-16'),presentation:null,searchText:null,...patch});
const after={notes:'Полное значение '.repeat(60),items:[{id:'item',name:'Шкаф',qty:2}]},before={notes:'Прежде',items:[{id:'item',name:'Шкаф',qty:1}]};
const receipt=(operationId:string,state:unknown,revision:number,noOp=false)=>raw({id:legacyKpInnerId('actor',operationId),action:'kp.write.receipt',newValue:{fingerprint:'core',result:{ok:true,proposalId:'proposal',projectId:'project',number:'203',revision,state,noOp}}});
function api(kind:string,result:unknown,operationId=op){
 const binding={actorId:'actor',operationId,source:'api',tokenId:'token-id'};
 return raw({id:`kp.api:${createHash('sha256').update(JSON.stringify(binding)).digest('hex')}`,action:'kp.api.command',
  newValue:{operationId,kind,scope:'kp:write',fingerprint:'api',entityId:'proposal',source:'api',tokenId:'token-id',result}});
}
const primary=()=>raw({oldValue:{revision:1},newValue:{revision:2,projectId:'project',itemIds:['item']}});
const database=(logs:JournalStoredEntry[],jobs:unknown[]=[])=>({$queryRaw:async(query:Prisma.Sql)=>query.sql.includes('FROM "ChangeLog"')?logs:query.sql.includes('FROM "ProposalJob"')?jobs:[]}) as unknown as JournalReferenceDb;

test('legacy API duplicate enriches the primary CP with exact states before hiding the wrapper',async()=>{
 const event=primary(),outer=api('document.save',{id:'proposal',revision:2,state:after,project:{id:'project'},canEdit:true});
 const logs=[event,outer,receipt(op,after,2),receipt(priorOp,before,1)],baseline=JSON.stringify(logs);
 const [business,wrapper]=await resolveJournalEntries(database(logs),[event,outer],true);
 assert.equal(business.presentation.changes.find(change=>change.path==='state.notes')?.before,'Прежде');
 assert.equal(business.presentation.changes.find(change=>change.path==='state.notes')?.after,after.notes);
 assert.ok(JSON.stringify(business.presentation.technical).includes(after.notes));
 assert.equal(wrapper.presentation.kind,'receipt');assert.equal(wrapper.presentation.technical.duplicateOf,event.id);
 assert.equal(wrapper.presentation.actor.name,'Снимок имени');assert.equal(wrapper.presentation.changes.length,0);
 assert.equal(JSON.stringify(logs),baseline);
});
test('ambiguous previous revision remains unknown; ambiguous mutation cannot suppress an API record',async()=>{
 const event=primary(),outer=api('document.save',{id:'proposal',revision:2,state:after});
 const logs=[event,outer,receipt(op,after,2),receipt(priorOp,before,1),receipt('a0000000-0000-4000-8000-000000000003',{...before,notes:'Другое'},1)];
 const [business]=await resolveJournalEntries(database(logs),[event],true);
 assert.equal(business.presentation.changes.find(change=>change.path==='state.notes')?.beforeKnown,false);
 logs.push(receipt('a0000000-0000-4000-8000-000000000004',{...after,notes:'Конфликт'},2));
 const [wrapper]=await resolveJournalEntries(database(logs),[outer],true);
 assert.equal(wrapper.presentation.kind,'event');assert.equal(wrapper.presentation.action.label,'Изменение');assert.equal(wrapper.presentation.changes.length,0);
 assert.ok(JSON.stringify(wrapper.presentation.technical.operationResult).includes(after.notes));
});
test('proven no-op and sole historical PDF receipt have distinct visibility',async()=>{
 const outer=api('document.save',{id:'proposal',revision:2,state:after});
 const [noOp]=await resolveJournalEntries(database([receipt(op,after,2,true)]),[outer],true);
 assert.equal(noOp.presentation.kind,'receipt');
 const pdf=api('pdf',{id:'job',state:'PENDING',result:null,error:null});
 const [sole]=await resolveJournalEntries(database([]),[pdf],true);
 assert.equal(sole.presentation.kind,'event');assert.equal(sole.presentation.action.label,'Запрос выпуска PDF');assert.equal(sole.presentation.changes.length,0);
 assert.deepEqual(sole.presentation.technical.operationResult,{id:'job',state:'PENDING',result:null,error:null});
 const companion=raw({id:'kp-pdf-request:job',action:'pdf.request',newValue:{jobId:'job',state:'PENDING'}});
 const [paired]=await resolveJournalEntries(database([companion]),[pdf],true);
 assert.equal(paired.presentation.kind,'receipt');assert.equal(paired.presentation.technical.duplicateOf,companion.id);
});
test('foreign actor and foreign proposal never count as duplicate proof, rich snapshots stay authoritative',async()=>{
 const event=primary(),outer=api('document.save',{id:'proposal',revision:2,state:after});
 const wrong={...receipt(op,after,2),actorId:'another'};
 const [kept]=await resolveJournalEntries(database([wrong,event]),[outer],true);assert.equal(kept.presentation.kind,'event');
 event.presentation=buildJournalPresentation(event,{before:{state:{notes:'Явное прежде'}},after:{state:{notes:'Явное после'}},entity:{label:'КП 203'}});
 const [rich]=await resolveJournalEntries(database([receipt(op,after,2),receipt(priorOp,before,1)]),[event],true);
 assert.equal(rich.presentation.changes.find(change=>change.path==='state.notes')?.after,'Явное после');assert.equal(rich.presentation.entity.label,'КП 203');
});
test('media preparation hides only after exact job-to-business binding and QA remains visible',async()=>{
 const media=raw({id:'kp.api.media:operation',action:'kp.api.media',newValue:{operationId:op,jobId:'job'}});
 const job={id:'job',proposalId:'proposal',createdById:'actor',kind:'UPLOAD_MEDIA',mediaId:'media',fileId:null,itemId:null};
 const created=raw({id:'media-create',entity:'proposalMedia',entityId:'media',action:'create',newValue:{proposalId:'proposal'}});
 const [pending]=await resolveJournalEntries(database([], [job]),[media],true);
 assert.equal(pending.presentation.kind,'event');assert.equal(pending.presentation.action.label,'Подготовка изображения');
 const [paired]=await resolveJournalEntries(database([created],[job]),[media],true);assert.equal(paired.presentation.kind,'receipt');
 assert.equal(legacyJournalActionLabel(raw({entity:'qa.kp187',action:'quarantine.apply'})),'Служебная операция проверки');
 assert.equal(legacyJournalActionLabel(raw({entity:'project',action:'qa.fixture.hide'})),'Неизвестная операция');
});
test('malformed core IDs and a different saved project cannot supply a historical snapshot',async()=>{
 for(const bad of [
  {...receipt(op,after,2),id:'kp:mutation:malformed'},
  {...receipt(op,after,2),newValue:{result:{ok:true,proposalId:'proposal',projectId:'foreign-project',revision:2,state:after,noOp:false}}},
 ]){
  const event=primary(),outer=api('document.save',{id:'proposal',revision:2,state:after,project:{id:'project'}});
  const [business,wrapper]=await resolveJournalEntries(database([bad,event]),[event,outer],true);
  assert.equal(business.presentation.technical.legacyKp,undefined);assert.equal(wrapper.presentation.kind,'event');
 }
});
