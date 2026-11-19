import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaRetentionRepository } from "../../src/server/kp/retention-repository";
import { executeProposalRetention, type RetentionStorage } from "../../src/server/kp/retention-executor";

/** Только guarded координатор + уже открытая transaction. S3 — память теста; все SQL-изменения откатываются. */
export async function verifyKpRetentionNative(tx: Prisma.TransactionClient, runId: string) {
  assert.match(runId,/^[a-f0-9-]{36}$/i,"KP188_NATIVE_RUN_ID_REQUIRED");
  await tx.$executeRaw`SAVEPOINT kp188_native`;
  const now=new Date(), prefix=`kp188-${runId}`, proposalId=prefix+'-proposal',projectId=prefix+'-project',actorId=prefix+'-actor';
  const binding={endpoint:'https://native188.invalid/',bucket:'native188-unit',region:'us-east-1'};
  const objects=new Map<string,{id:string;marker:boolean;bytes:Buffer}[]>();
  const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  const object=(key:string,mimeType='image/jpeg',bytes=Buffer.from(key))=>{objects.set(key,[{id:'first',marker:false,bytes},{id:'second',marker:false,bytes},{id:'marker',marker:true,bytes:Buffer.alloc(0)}]);return{key,sha256:sha(bytes),size:bytes.length,mimeType};};
  const checks:string[]=[];
  try{
    await tx.user.create({data:{id:actorId,email:actorId+'@example.invalid',name:'Проверка188',roles:['ADMIN'],passwordHash:'NATIVE188_NO_PASSWORD_LOGIN'}});
    const client=await tx.client.create({data:{name:'Синтетический клиент188',phone:'NATIVE188'}});
    let numberInt=1_850_000_000+parseInt(sha(Buffer.from(runId)).slice(0,6),16);
    while(await tx.project.count({where:{number:String(numberInt)}}))numberInt--;
    await tx.project.create({data:{id:projectId,clientId:client.id,number:String(numberInt),numberInt,title:'Проверка188',stage:'IN_WORK'}});
    await tx.$executeRaw`INSERT INTO "CommercialProposal"(id,"projectId",state,revision,"retentionEpoch","createdAt","updatedAt")
      VALUES(${proposalId},${projectId},'{"items":[]}'::jsonb,1,2,${now},${now})`;
    const acceptedId=prefix+'-accepted',oldId=prefix+'-old',sharedId=prefix+'-shared',unusedId=prefix+'-unused';
    for(const mediaId of[sharedId,unusedId]){
      const original=object(`kp/proposals/${proposalId}/original/${mediaId}.jpg`),optimized=object(`kp/proposals/${proposalId}/optimized/${mediaId}.jpg`);
      await tx.$executeRaw`INSERT INTO "ProposalMedia"(id,"proposalId","storageBinding","originalKey","originalHash","originalSize","optimizedKey","optimizedHash","optimizedSize","mimeType","optimizedMimeType","fileName","expiresAt")
        VALUES(${mediaId},${proposalId},${JSON.stringify(binding)}::jsonb,${original.key},${original.sha256},${original.size},${optimized.key},${optimized.sha256},${optimized.size},'image/jpeg','image/jpeg','Native188.jpg',${new Date(now.getTime()+366*24*3600_000)})`;
    }
    for(const[id,versionId]of[[prefix+'-pdf-kept',acceptedId],[prefix+'-pdf-old',oldId]]){
      const pdf=object(`kp/proposals/${proposalId}/exports/${id}.pdf`,'application/pdf');
      await tx.$executeRaw`INSERT INTO "ProposalArtifact"(id,"proposalId",kind,state,"storageBinding",key,sha256,size,"fileName","mimeType")
        VALUES(${id},${proposalId},'PDF','READY',${JSON.stringify(binding)}::jsonb,${pdf.key},${pdf.sha256},${pdf.size},'Native188.pdf','application/pdf')`;
      await tx.$executeRaw`INSERT INTO "ProposalVersion"(id,"proposalId",revision,trigger,state,"pricingSnapshot","templateVersion","pdfArtifactId")
        VALUES(${versionId},${proposalId},1,'PDF','{"items":[]}'::jsonb,'{}'::jsonb,'native188',${id})`;
      await tx.$executeRaw`INSERT INTO "ProposalVersionMedia"("proposalId","versionId","mediaId")VALUES(${proposalId},${versionId},${sharedId})`;
      if(versionId===oldId)await tx.$executeRaw`INSERT INTO "ProposalVersionMedia"("proposalId","versionId","mediaId")VALUES(${proposalId},${versionId},${unusedId})`;
    }
    await tx.$executeRaw`UPDATE "CommercialProposal"SET"acceptedVersionId"=${acceptedId},"acceptedAt"=${now} WHERE id=${proposalId}`;
    await tx.$executeRaw`INSERT INTO "ProposalCurrentMedia"("proposalId","mediaId")VALUES(${proposalId},${sharedId})`;
    const cleanupId=randomUUID(),payload={schema:1,kind:'ACCEPTED_RETENTION',proposalId,acceptedVersionId:acceptedId,retentionEpoch:2};
    await tx.$executeRaw`INSERT INTO "ProposalJob"(id,"proposalId",kind,"dedupeKey",payload,"retentionEpoch","createdAt","updatedAt")
      VALUES(${cleanupId},${proposalId},'PRUNE_VERSIONS',${'native188:prune:'+runId},${JSON.stringify(payload)}::jsonb,2,${now},${now})`;
    const storage:RetentionStorage={currentBinding:()=>binding,
      async list(_binding,key){return{entries:(objects.get(key)??[]).map(row=>({key,id:row.id,marker:row.marker}))};},
      async head(_binding,key){const last=objects.get(key)?.at(-1);return last&&!last.marker?{size:last.bytes.length}:null;},
      async digest(_binding,key,id){const rows=objects.get(key)??[],row=id===null?rows.at(-1):rows.find(value=>value.id===id);return row&&!row.marker?{size:row.bytes.length,sha256:sha(row.bytes)}:null;},
      async deleteVersion(){ throw Error("PUBLISHED_RETENTION_PHYSICAL_DELETE_FORBIDDEN"); }};
    const nested={$transaction:((action:(connection:Prisma.TransactionClient)=>Promise<unknown>)=>action(tx))as unknown as PrismaClient['$transaction']};
    const repository=createPrismaRetentionRepository(nested,{now:()=>now});
    const claim=await repository.claim('native188',120_000,cleanupId);assert.ok(claim);
    await assert.rejects(executeProposalRetention({repository,storage,enabled:()=>true,now:()=>now},claim),/CANCELLED/);
    assert.ok(await tx.proposalVersion.findUnique({where:{id:oldId}}));
    assert.equal((await tx.proposalArtifact.findUniqueOrThrow({where:{id:prefix+'-pdf-kept'}})).state,'READY');
    assert.equal((await tx.proposalArtifact.findUniqueOrThrow({where:{id:prefix+'-pdf-old'}})).state,'READY');
    assert.equal(objects.get("kp/proposals/"+proposalId+"/optimized/"+sharedId+".jpg")!.length,3);
    assert.equal(objects.get("kp/proposals/"+proposalId+"/optimized/"+unusedId+".jpg")!.length,3);
    checks.push('native-business-history-cancels-prune-and-preserves-all-versions');

    const productId=prefix+'-product',itemId=prefix+'-item',fileId=randomUUID(),copyJobId=randomUUID();
    await tx.product.create({data:{id:productId,projectId,number:`${numberInt}.1`,suffixInt:1,title:'Копия188',status:'PREPARATION'}});
    await tx.$executeRaw`INSERT INTO "ProposalItem"(id,"proposalId","productId",position,state,"createdAt","updatedAt")VALUES(${itemId},${proposalId},${productId},1,'{}'::jsonb,${now},${now})`;
    const storedName=`kp-${copyJobId}.jpg`,copyObject=object(`${projectId}/${storedName}`,'image/jpeg',Buffer.from(`kp/proposals/${proposalId}/optimized/${sharedId}.jpg`));
    const copyPayload={schema:1,kind:'COPY_PRODUCT_MEDIA',proposalId,projectId,itemId,mediaId:sharedId,fileId,storedName,binding,optimized:copyObject};
    await tx.$executeRaw`INSERT INTO "ProposalJob"(id,"proposalId",kind,state,"dedupeKey",payload,result,"createdById","createdAt","updatedAt")
      VALUES(${copyJobId},${proposalId},'COPY_PRODUCT_MEDIA','SUCCEEDED',${'native188:copy:'+runId},${JSON.stringify(copyPayload)}::jsonb,'{"copyReady":true,"attached":true}'::jsonb,${actorId},${now},${now})`;
    await tx.$executeRaw`INSERT INTO "File"(id,"projectId","productId",section,"fileName","storedName","mimeType",size,"uploadedById","proposalSourceItemId","proposalSourceMediaId","proposalMediaCopyJobId","proposalMediaRetiredAt")
      VALUES(${fileId},${projectId},${productId},'PRODUCTION','Native188.jpg',${storedName},'image/jpeg',${copyObject.size},${actorId},${itemId},${sharedId},${copyJobId},${now})`;
    const retireId=randomUUID(),retire={schema:1,kind:'RETIRED_PRODUCT_COPY',proposalId,projectId,fileId,storedName,sourceMediaId:sharedId,operationJobId:copyJobId,binding,objects:[copyObject]};
    await tx.$executeRaw`INSERT INTO "ProposalJob"(id,"proposalId",kind,"dedupeKey",payload,"createdById","createdAt","updatedAt")
      VALUES(${retireId},${proposalId},'PURGE_MEDIA',${'native188:retired:'+runId},${JSON.stringify(retire)}::jsonb,${actorId},${now},${now})`;
    const copyClaim=await repository.claim('native188',120_000,retireId);assert.ok(copyClaim);
    await assert.rejects(executeProposalRetention({repository,storage,enabled:()=>true,now:()=>now},copyClaim),/CANCELLED/);
    assert.ok((await tx.file.findUniqueOrThrow({where:{id:fileId}})).proposalMediaRetiredAt);
    assert.equal(objects.get(copyObject.key)!.length,3);
    checks.push('native-retired-file-row-and-storage-versions-preserved');
    return checks;
  }finally{await tx.$executeRaw`ROLLBACK TO SAVEPOINT kp188_native`;await tx.$executeRaw`RELEASE SAVEPOINT kp188_native`;}
}
