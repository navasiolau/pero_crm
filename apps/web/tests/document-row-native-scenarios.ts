import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {PrismaClient} from '@prisma/client';
import {listMovements} from '../src/server/warehouse/queries';import {loadOrganizationPayments} from '../src/server/finance/organization-ledger';
import {createDocumentRowFixture,documentRowBaseline} from './helpers/document-row-fixture';
export async function runDocumentRowNative(db:PrismaClient){
 const before=await documentRowBaseline(db),rollback=new Error('DOCUMENT_ROW_ROLLBACK');let verified=false;
 try{await db.$transaction(async tx=>{
  const marker='qa-document-row-'+randomUUID(),f=await createDocumentRowFixture(tx,marker),documentId=randomUUID();
  await tx.financeDocument.create({data:{id:documentId,uploadedById:marker,clientMutationId:randomUUID(),requestFingerprint:marker,fileName:'QA97-report.pdf',mimeType:'application/pdf',size:4,contentHash:'0'.repeat(64),storageMode:'local',storageKey:'finance-documents/'+documentId+'/'+'0'.repeat(64),state:'READY',readyAt:new Date()}});
  await tx.payment.update({where:{id:f.payment.id},data:{reportDocumentId:documentId}});
  const actor={id:marker,roles:f.user.roles};
  const movements=await listMovements(actor,{materialId:f.material.id},tx);
  const ledger=await loadOrganizationPayments(actor,'EXPENSE',tx);
  assert.equal(movements.find(row=>row.id===f.paid.id)?.reportDocument?.id,documentId);
  assert.deepEqual(movements.find(row=>row.id===f.paid.id)?.reportDocument,ledger.rows.find(row=>row.id===f.payment.id)?.reportDocument);
  assert.equal(movements.find(row=>row.id===f.inventory.id)?.reportDocument,null);
  assert.equal(ledger.rows.find(row=>row.id===marker+'-old')?.reportDocument,null);
  const manager=await listMovements({id:marker,roles:['MANAGER']},{materialId:f.material.id},tx);
  assert.ok(manager.every(row=>row.reportDocument===null));assert.ok(!JSON.stringify(manager).includes(documentId));
  const combined=await listMovements({id:marker,roles:['MANAGER','PROCUREMENT']},{materialId:f.material.id},tx);
  assert.equal(combined.find(row=>row.id===f.paid.id)?.reportDocument?.id,documentId);
  await tx.financeDocument.update({where:{id:documentId},data:{state:'PENDING',readyAt:null}});
  assert.ok((await listMovements(actor,{materialId:f.material.id},tx)).every(row=>row.reportDocument===null));
  verified=true;throw rollback;
 },{timeout:15000});}catch(error){if(error!==rollback)throw error;}
 assert.ok(verified);assert.deepEqual(await documentRowBaseline(db),before);
 return {status:'PASS',sameDocument:'PAYMENT_AND_STOCK',missingAndPending:'NO_BUTTON_DATA',financialRoles:'UNION_WITHOUT_MANAGER_LEAK',originalData:'MATCH',qaRows:'ROLLED_BACK'};
}
