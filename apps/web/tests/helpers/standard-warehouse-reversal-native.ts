import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { warehouseMove } from "../../src/server/warehouse/accounting";
import { createStockPurchaseInTransaction, prepareStockPurchase } from "../../src/server/warehouse/stock-purchase-core";
import { previewMovementDeletionInTransaction, deleteMovementInTransaction } from "../../src/server/warehouse/deletion-core";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { readCashBalance } from "../../src/server/payroll/cash-core";

export async function verifyStandardWarehouseReversalNative(tx: Prisma.TransactionClient) {
  const run=randomUUID();
  const user=await tx.user.create({data:{email:`${run}@example.invalid`,name:"Проверка №259",passwordHash:"QA259_NO_LOGIN",roles:["ADMIN"]}});
  const actor={id:user.id,name:user.name,roles:user.roles,source:"web" as const};
  const unit=await tx.materialUnit.create({data:{name:`QA259 ${run}`}});
  const material=await tx.material.create({data:{name:"Проверка №259",unitId:unit.id}});
  const account=await tx.cashAccount.create({data:{name:`QA259 ${run}`,currency:"BYN"}});
  const article=await tx.expenseArticle.create({data:{name:`QA259 ${run}`,code:((await tx.expenseArticle.aggregate({_max:{code:true}}))._max.code??0)+1}});
  await tx.payment.create({data:{cashAccountId:account.id,amount:"200",bynAmount:"200",direction:"INCOME"}});
  const report=await tx.financeDocument.create({data:{uploadedById:actor.id,clientMutationId:randomUUID(),requestFingerprint:run,
    fileName:"Проверка №259.pdf",mimeType:"application/pdf",size:1,contentHash:run,storageKey:`qa259/${run}`,storageMode:"local",state:"READY",readyAt:new Date()}});
  const move=await warehouseMove(tx,actor,{kind:"INCOME",materialId:material.id,quantity:"5",unitPrice:"2",clientMutationId:randomUUID()});
  const request={clientMutationId:randomUUID(),materialId:material.id,quantity:"3",unitPrice:"2",currency:"BYN",
    cashAccountId:account.id,expenseArticleId:article.id,reportDocumentId:report.id};
  const {prepared}=await prepareStockPurchase(actor,request,tx,async()=>assert.fail("UNEXPECTED_FX"));
  const {receipt}=await createStockPurchaseInTransaction(actor,request,prepared,tx);
  const cash=async()=>(await readCashBalance(tx,account.id)).toFixed(2);
  assert.equal(await cash(),"194.00");
  const paidAudit=await tx.changeLog.findFirstOrThrow({where:{entity:"stockMovement",entityId:receipt.movementId,action:"create"}});
  const child=await tx.changeLog.findFirstOrThrow({where:{entity:"payment",entityId:receipt.paymentId,operationRootId:paidAudit.id}});
  assert.equal(child.operationRootId,paidAudit.id);
  const reverse=async(entryId:string)=>{
    const input={entryId,requestId:randomUUID(),scope:{kind:"global"}};
    await previewJournalReversalInTransaction(tx,actor.id,input);
    const first=await reverseJournalActionInTransaction(tx,actor.id,input);
    assert.equal((await reverseJournalActionInTransaction(tx,actor.id,input)).reversalId,first.reversalId);
    return first;
  };
  const paidDeleted=await reverse(child.id);
  assert.equal(await cash(),"200.00");
  const hidden=await tx.stockMovement.findUniqueOrThrow({where:{id:receipt.movementId}});
  assert.ok(hidden.deletionId);
  await tx.$executeRaw`SAVEPOINT qa259_cash`;
  try {
    await tx.payment.create({data:{direction:"EXPENSE",cashAccountId:account.id,amount:"199",bynAmount:"199"}});
    await assert.rejects(()=>previewJournalReversalInTransaction(tx,actor.id,{entryId:paidDeleted.reversalId,scope:{kind:"global"}}),/Недостаточно средств в кассе/);
  } finally {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT qa259_cash`;
    await tx.$executeRaw`RELEASE SAVEPOINT qa259_cash`;
  }
  await reverse(paidDeleted.reversalId);
  const restored=await tx.payment.findUniqueOrThrow({where:{id:receipt.paymentId}});
  assert.equal(restored.reportDocumentId,report.id);
  assert.equal(restored.deletionId,null);
  assert.equal(await cash(),"194.00");
  const client=await tx.client.create({data:{name:"Проверка №259",phone:"QA259"}});
  const numberInt=1_600_000_000+Number.parseInt(run.slice(0,7),16);
  const project=await tx.project.create({data:{clientId:client.id,title:"Проверка №259",numberInt,number:String(numberInt),currency:"BYN"}});
  const product=await tx.product.create({data:{projectId:project.id,title:"Проверка №259",number:`${numberInt}.1`,suffixInt:1,status:"PRODUCTION"}});
  const line=await tx.projectMaterial.create({data:{productId:product.id,materialId:material.id,quantity:"8.000"}});
  const issue=await warehouseMove(tx,actor,{kind:"EXPENSE",projectMaterialId:line.id,quantity:"5",clientMutationId:randomUUID()});
  const returned=await warehouseMove(tx,actor,{kind:"RETURN",projectMaterialId:line.id,sourceMovementId:issue.movement.id,quantity:"1",clientMutationId:randomUUID()});
  const issueRoot=await tx.changeLog.findFirstOrThrow({where:{entityId:issue.movement.id,action:"create"}});
  await assert.rejects(()=>previewJournalReversalInTransaction(tx,actor.id,{entryId:issueRoot.id,scope:{kind:"global"}}),/зависимые движения/);
  const returnRoot=await tx.changeLog.findFirstOrThrow({where:{entityId:returned.movement.id,action:"create"}});
  const returnDeleted=await reverse(returnRoot.id);
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:line.id}})).issuedQty.toFixed(3),"5.000");
  await reverse(returnDeleted.reversalId);
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:line.id}})).issuedQty.toFixed(3),"4.000");
  const preview=await previewMovementDeletionInTransaction(tx,actor,move.movement.id);
  assert.equal(preview.movements.length>1,true);
  const deletion=await deleteMovementInTransaction(tx,actor,{movementId:move.movement.id,planFingerprint:preview.planFingerprint,clientMutationId:randomUUID()});
  const manual=await tx.changeLog.findFirstOrThrow({where:{entityId:move.movement.id,action:"softDelete"}});
  await reverse(manual.id);
  assert.ok((await tx.warehouseMovementDeletion.findUniqueOrThrow({where:{id:deletion.id}})).restoredAt);
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:line.id}})).issuedQty.toFixed(3),"4.000");
  const previousIssue=await tx.warehouseMovementValuation.findUniqueOrThrow({where:{movementId:issue.movement.id}});
  assert.equal(previousIssue.returnedQuantity.toFixed(3),"1.000");
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  return {paidIdsPreserved:true,documentPreserved:true,returnCountersRestored:true,groupRestored:true,dependentUndoRefused:true};
}
