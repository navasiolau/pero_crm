import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {Prisma} from '@prisma/client';
import {createProductMediaCopyPlan} from '../src/server/kp/media-core';
import {mediaObjectKeys,type MediaPlan} from '../src/server/kp/media-contract';
import {linkProposalProductMediaInTransaction} from '../src/server/kp/media-product-sync';
import {parseJournalPresentation} from '../src/server/changelog/presentation';

test('первая и заменяющая обложки из КП сохраняют имена новых файлов в сравнении',async()=>{
  const now=new Date('2026-11-16T12:00:00Z'),binding={endpoint:'https://fixture.invalid/',bucket:'fixture'};
  const owner={proposalId:'proposal',projectId:'project',revision:1,createdAt:now};
  const itemId=randomUUID(),product={id:'product',number:'203.1',sketchFileId:null as string|null};
  const plans=new Map<string,MediaPlan>(),media=new Map<string,Record<string,unknown>>();
  const files:Record<string,unknown>[]=[],currentMedia=new Set<string>(),logs:Record<string,unknown>[]=[];
  function prepared(mediaId:string,fileName:string){
    const key=mediaObjectKeys(owner.proposalId,mediaId,'image/png','image/png').optimized;
    const source={binding,object:{key,sha256:'a'.repeat(64),size:100,mimeType:'image/png' as const},fileName,width:2,height:2};
    const plan=createProductMediaCopyPlan(owner,{actorId:'manager',proposalId:owner.proposalId,expectedRevision:1,operationId:randomUUID(),binding,itemId,mediaId},source);
    plans.set(plan.jobId,plan);
    media.set(mediaId,{id:mediaId,proposalId:owner.proposalId,uploadState:'READY',uploadJobId:null,storageBinding:binding,optimizedKey:key,optimizedHash:source.object.sha256,
      optimizedSize:100,optimizedMimeType:'image/png',mimeType:'image/png',fileName,expiresAt:new Date('2027-11-16T12:00:00Z'),retiringAt:null,optimizedPurgedAt:null});
    return plan;
  }
  const sql=(query:TemplateStringsArray|Prisma.Sql)=>Array.isArray(query)?query.join(''):(query as Prisma.Sql).strings.join('');
  const tx={
    $queryRaw:async(query:TemplateStringsArray|Prisma.Sql,...values:unknown[])=>{
      const text=sql(query),args=Array.isArray(query)?values:(query as Prisma.Sql).values;
      if(text.includes('pg_advisory_xact_lock')||text.includes('SELECT id FROM'))return[];
      if(text.includes('SELECT "projectId" FROM "CommercialProposal"'))return[{projectId:owner.projectId}];
      if(text.includes('cp.id AS "proposalId"'))return[{...owner,deletedAt:null,stage:'LEAD',projectDeletedAt:null}];
      if(text.includes('FROM "User"'))return[{active:true,roles:['MANAGER'],name:'Менеджер'}];
      if(text.includes('SELECT * FROM "ProposalJob"')){const plan=plans.get(String(args[0]));assert.ok(plan);return[{id:plan.jobId,kind:'COPY_PRODUCT_MEDIA',state:'SUCCEEDED',proposalId:owner.proposalId,createdById:'manager',payload:plan}];}
      if(text.includes('SELECT state FROM "ProposalJob"'))return[{state:'PENDING'}];
      if(text.includes('JOIN "ProposalJob"'))return structuredClone(files);
      if(text.includes('FROM "ProposalCurrentMedia"'))return [...currentMedia].map(mediaId=>({mediaId}));
      if(text.includes('FROM "Product"'))return[{...product}];
      if(text.includes('FROM "ProposalMedia"'))return [media.get(String(args.find(value=>media.has(String(value)))))];
      if(text.includes('FROM "DomainEvent"'))return[];
      throw Error('Непредусмотренный fixture query: '+text);
    },
    $executeRaw:async(query:TemplateStringsArray|Prisma.Sql,...values:unknown[])=>{
      const text=sql(query),args=Array.isArray(query)?values:(query as Prisma.Sql).values;
      if(text.includes('INSERT INTO "File"'))files.push({id:args[0],projectId:args[1],productId:args[2],fileName:args[3],storedName:args[4],proposalSourceItemId:args[8],proposalSourceMediaId:args[9],proposalMediaCopyJobId:args[10],proposalMediaRetiredAt:null,payload:plans.get(String(args[10]))});
      if(text.includes('UPDATE "File"')){const file=files.find(file=>file.id===args[1]);assert.ok(file);file.proposalMediaRetiredAt=args[0];}
      if(text.includes('DELETE FROM "ProposalCurrentMedia"'))currentMedia.clear();
      if(text.includes('INSERT INTO "ProposalCurrentMedia"'))currentMedia.add(String(args[1]));
      return 1;
    },
    proposalCurrentMedia:{updateMany:async({where}:{where:{mediaId:{in:string[]}}})=>{
      for(const id of where.mediaId.in)currentMedia.delete(id);
      return {count:where.mediaId.in.length};
    }},
    file:{update:async({where,data}:{where:{id:string};data:{proposalMediaRetiredAt:null}})=>{
      const file=files.find(file=>file.id===where.id);assert.ok(file);Object.assign(file,data);return file;
    }},
    product:{findUnique:async()=>({...product}),update:async({data}:{data:{sketchFileId:string|null}})=>Object.assign(product,data),
      updateMany:async({where,data}:{where:{sketchFileId:string};data:{sketchFileId:null}})=>{if(product.sketchFileId!==where.sketchFileId)return{count:0};Object.assign(product,data);return{count:1};}},
    changeLog:{create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}},
  } as unknown as Prisma.TransactionClient;
  const context={actor:{id:'manager',name:'Менеджер',source:'web' as const},proposalId:owner.proposalId,proposal:{revision:1},project:{id:owner.projectId},items:[{id:itemId,productId:product.id}]};
  for(const [index,fileName] of ['Первое изображение.png','Заменяющее изображение.png'].entries()){
    const plan=prepared(`media-${index}`,fileName),oldId=product.sketchFileId;
    await linkProposalProductMediaInTransaction(tx,{...context,state:{items:[{id:itemId,image:`kp-media:${plan.mediaId}`}]}},
      {storage:{currentBinding:()=>binding},preparedCopies:{proposalId:owner.proposalId,expectedRevision:1,jobs:[plan.jobId]},now});
    const log=logs.filter(log=>log.action==='kp.cover').at(-1);assert.ok(log);
    const view=parseJournalPresentation(log.presentation);assert.ok(view);
    const change=view.changes.find(change=>change.path==='sketchFileId');assert.ok(change);
    assert.equal(change.after,fileName,'Новый файл должен иметь сохранённое имя');
    assert.equal(change.before,index?'Первое изображение.png':null,'Прежний файл должен иметь сохранённое имя');
    assert.deepEqual(log.newValue,{proposalId:owner.proposalId,previousFileId:oldId,sketchFileId:plan.fileId});
  }
  const original=files[0];
  assert.ok(original.proposalMediaRetiredAt);
  await linkProposalProductMediaInTransaction(tx,{...context,state:{items:[{id:itemId,image:"kp-media:media-0"}]}},
    {storage:{currentBinding:()=>binding},preparedCopies:{proposalId:owner.proposalId,expectedRevision:1,jobs:[]},now});
  assert.equal(original.proposalMediaRetiredAt,null);
  assert.equal(product.sketchFileId,original.id);
  assert.equal(files.length,2);
  assert.ok(logs.some(log=>log.action==="restore"&&log.entityId===original.id));
});
