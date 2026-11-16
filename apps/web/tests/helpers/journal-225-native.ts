import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ContractModel } from "@pero/kp-template";
import { createProposalInTransaction, saveProposalInTransaction, type ProposalSaveHooks } from "../../src/server/kp/proposal-core";
import { projectProposalPricing } from "../../src/server/kp/pricing";
import { applyProjectionInTransaction } from "../../src/server/kp/pricing-persistence";
import { createProjectInTransaction } from "../../src/server/projects/core";
import { projectProductsVersion, softDeleteProjectCore } from "../../src/server/projects/delete-core";
import { promoteProjectDrafts } from "../../src/server/products/draft-core";
import {patchProductCore} from '../../src/server/products/core';
import { createContractWorkflow } from "../../src/server/kp/contract-workflow";
import { createPostgresContractTransaction } from "../../src/server/kp/contract-store";
import { createContractModelPort } from "../../src/server/kp/contract-model";
import { parseJournalPresentation } from "../../src/server/changelog/presentation";
import { contractWorkflowFixture } from "./contract-workflow-fixture";

/** Только caller-owned rollback transaction. Не открывает соединения, не вызывает сеть или dispatch. */
export async function runJournal225NativeCases(tx: Prisma.TransactionClient, options: { runId: string; rollbackOnly: true; expectedDatabase: string }) {
  if (options.rollbackOnly !== true || !/^[0-9a-f-]{36}$/i.test(options.runId) || !options.expectedDatabase)
    throw Error("JOURNAL225_ROLLBACK_DECLARATION_REQUIRED");
  const [identity] = await tx.$queryRaw<{database:string}[]>`SELECT current_database() AS database`;
  if (identity?.database !== options.expectedDatabase) throw Error("JOURNAL225_DATABASE_GUARD_MISMATCH");
  const prefix = `journal225_${options.runId.replaceAll("-", "")}`;
  const actor = { id: `${prefix}_user`, name: `QA ${prefix}`, roles: ["MANAGER" as const], source: "web" as const };
  const temporaryId = `${prefix}_temporary`;
  await tx.user.create({data:{id:actor.id,email:`${prefix}@example.invalid`,name:actor.name,roles:actor.roles,passwordHash:"disabled-journal-native-password",active:true}});
  await tx.client.create({data:{id:temporaryId,name:"Временный",phone:"QA"}});
  const hooks: ProposalSaveHooks = {environment:{PERO_KP_TEMP_CLIENT_ID:temporaryId},
    applyPricing: async (transaction,context) => {
      await applyProjectionInTransaction(transaction,context,projectProposalPricing(context.state,
        {currency:"BYN",value:"1",date:"2026-11-16",source:"MANUAL"}));
      return {changed:true};
    }};
  const created = await createProposalInTransaction(tx,actor,{operationId:randomUUID(),state:{currency:"BYN",order:{project:prefix},
    items:[{name:"QA изделие",qty:1,price:100},{name:'QA соседнее изделие',qty:1,price:50}],notes:"Прежнее полное описание"}},hooks);
  const productId=created.result.items[0].productId;
  const normWork=await tx.work.create({data:{id:`${prefix}_norm_work`,projectId:created.result.projectId,productId,title:'QA сборка',
    quantity:'2.00',quantityPerUnit:'2.00',priceSnapshot:'10.00',total:'20.00',unitSnapshot:'шт',createdById:actor.id}});
  const normUnit=await tx.materialUnit.create({data:{id:`${prefix}_norm_unit`,name:`${prefix}_шт`}});
  const material=await tx.material.create({data:{id:`${prefix}_material`,name:'QA петли',unitId:normUnit.id,purchasePrice:'3.00'}});
  const normMaterial=await tx.projectMaterial.create({data:{id:`${prefix}_norm_material`,productId,materialId:material.id,quantity:'3.000',quantityPerUnit:'3.000',createdById:actor.id}});
  const text="Полное нативное описание ".repeat(80)+"конец";
  const [firstItem,secondItem]=created.result.state.items;
  const request={operationId:randomUUID(),proposalId:created.result.proposalId,expectedRevision:created.result.revision,
    state:{...created.result.state,notes:text,items:[secondItem,{...firstItem,name:"Изменённое QA изделие",qty:2,price:125}]}};
  const updated=await saveProposalInTransaction(tx,actor,request,hooks);
  const logs=await tx.changeLog.findMany({where:{actorId:actor.id}});
  const proposalLog=logs.find(log=>log.entity==='commercialProposal'&&log.action==='update');
  assert.ok(proposalLog);
  const proposalView=parseJournalPresentation(proposalLog.presentation);assert.ok(proposalView);
  assert.ok(JSON.stringify(proposalView.changes).includes(text));
  assert.ok(JSON.stringify(proposalView.changes).includes('Прежнее полное описание'));
  assert.deepEqual(proposalLog.oldValue,{revision:created.result.revision});
  assert.deepEqual(proposalLog.newValue,{revision:updated.result.revision,projectId:created.result.projectId,itemIds:updated.result.items.map(item=>item.id)});
  const priceLog=logs.find(log=>log.entity==='product'&&log.entityId===productId&&log.action==='proposal.pricing.sync'&&JSON.stringify(log.oldValue).includes('100'));
  assert.ok(priceLog);const priceView=parseJournalPresentation(priceLog.presentation);assert.ok(priceView);
  assert.equal(priceView.actor.type,'system');assert.equal(priceView.initiator?.id,actor.id);
  assert.deepEqual(priceView.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:productId}]);
  const count=logs.length;await saveProposalInTransaction(tx,actor,request,hooks);
  assert.equal(await tx.changeLog.count({where:{actorId:actor.id}}),count);
  const currentWork=await tx.work.findUniqueOrThrow({where:{id:normWork.id}}),currentMaterial=await tx.projectMaterial.findUniqueOrThrow({where:{id:normMaterial.id}});
  assert.equal(currentWork.quantity.toFixed(2),'4.00');assert.equal(currentWork.total?.toFixed(2),'40.00');assert.equal(currentWork.priceSnapshot?.toFixed(2),'10.00');
  assert.equal(currentMaterial.quantity.toFixed(3),'6.000');assert.equal(currentMaterial.issuedQty.toFixed(3),'0.000');
  for(const [entity,id,label] of [['work',normWork.id,'QA сборка'],['projectMaterial',normMaterial.id,'QA петли']] as const){
    const event=logs.find(log=>log.entity===entity&&log.entityId===id);assert.ok(event,'JOURNAL225_NORM_EVENT');
    const view=parseJournalPresentation(event.presentation);assert.ok(view,'JOURNAL225_NORM_PRESENTATION');
    assert.deepEqual(event.oldValue,entity==='work'?{quantity:'2',quantityPerUnit:'2',total:'20'}:{quantity:'3',quantityPerUnit:'3'});
    assert.deepEqual(event.newValue,entity==='work'?{quantity:'4',quantityPerUnit:'2',total:'40'}:{quantity:'6',quantityPerUnit:'3'});
    assert.equal(view.entity.label,label);assert.equal(view.actor.type,'system');assert.equal(view.initiator?.id,actor.id);
    assert.deepEqual(view.contexts.map(({kind,id,label})=>({kind,id,label})),[{kind:'product',id:productId,label:`Изделие ${created.result.number}.2`}]);
    assert.ok(!JSON.stringify(view).includes('__kp_sync'),'JOURNAL225_NO_TEMPORARY_PRODUCT_NUMBER');
  }
  const manualRequest={productId,field:'quantity' as const,value:3,expectedValue:2,clientMutationId:randomUUID()};
  const manual=await patchProductCore(actor,manualRequest,async run=>run(tx));assert.equal(manual.kind,'saved');
  assert.equal((await tx.work.findUniqueOrThrow({where:{id:normWork.id}})).total?.toFixed(2),'60.00');
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:normMaterial.id}})).quantity.toFixed(3),'9.000');
  const countAfterManual=await tx.changeLog.count({where:{actorId:actor.id}});await patchProductCore(actor,manualRequest,async run=>run(tx));
  assert.equal(await tx.changeLog.count({where:{actorId:actor.id}}),countAfterManual);
  const beforeNormFailure={work:await tx.work.findUniqueOrThrow({where:{id:normWork.id}}),material:await tx.projectMaterial.findUniqueOrThrow({where:{id:normMaterial.id}}),quantity:(await tx.product.findUniqueOrThrow({where:{id:productId}})).quantity};
  const beforeNormFailureLogCount=await tx.changeLog.count({where:{actorId:actor.id}});
  const normFailing=new Proxy(tx,{get(target,key){if(key==='changeLog')return new Proxy(target.changeLog,{get(delegate,method){
    if(method==='create')return async(args:Parameters<typeof tx.changeLog.create>[0])=>{if(args.data.entity==='projectMaterial')throw Error('JOURNAL225_NORM_AUDIT_FAULT');return target.changeLog.create(args);};
    return Reflect.get(delegate,method);}});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const normFailure=await patchProductCore(actor,{productId,field:'quantity',value:4,expectedValue:3,clientMutationId:randomUUID()},async run=>{
    await tx.$executeRawUnsafe('SAVEPOINT journal225_norm_fault');
    try{return await run(normFailing);}catch(error){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT journal225_norm_fault');throw error;}
    finally{await tx.$executeRawUnsafe('RELEASE SAVEPOINT journal225_norm_fault');}
  });
  assert.equal(normFailure.kind,'failure');
  assert.deepEqual({work:await tx.work.findUniqueOrThrow({where:{id:normWork.id}}),material:await tx.projectMaterial.findUniqueOrThrow({where:{id:normMaterial.id}}),quantity:(await tx.product.findUniqueOrThrow({where:{id:productId}})).quantity},beforeNormFailure);
  assert.equal(await tx.changeLog.count({where:{actorId:actor.id}}),beforeNormFailureLogCount);

  const fixture=contractWorkflowFixture();
  const workflow=createContractWorkflow({...fixture.ports,temporaryClientId:temporaryId,model:createContractModelPort(ContractModel),
    store:{transaction:run=>run(createPostgresContractTransaction(tx))}});
  const binding={id:actor.id,source:'web' as const,sessionVersion:0};
  const form=await workflow.form(binding,created.result.proposalId);
  const originalContractText='Исходное условие договора '.repeat(20)+'до';
  const contractText='Полное условие договора '.repeat(50)+'конец';
  assert.ok(contractText.length>60&&contractText.length<=2000,'JOURNAL225_VALID_CONTRACT_TEXT');
  assert.equal(createContractModelPort(ContractModel).normalizeSettings({...form.settings,subject:contractText},{},created.result.proposalId).subject,contractText,'JOURNAL225_MODEL_PRESERVES_VALID_SUBJECT');
  await workflow.saveDraft(binding,{documentId:created.result.proposalId,expectedRevision:form.revision,sourceRefs:form.sourceRefs,
    clientBaseline:form.clientBaseline,operationId:randomUUID(),settings:{...form.settings,subject:originalContractText}});
  const currentForm=await workflow.form(binding,created.result.proposalId);
  const contractRequest={documentId:created.result.proposalId,expectedRevision:currentForm.revision,sourceRefs:currentForm.sourceRefs,
    clientBaseline:currentForm.clientBaseline,operationId:randomUUID(),settings:{...currentForm.settings,subject:contractText}};
  const saved=await workflow.saveDraft(binding,contractRequest);
  const receipt=await tx.changeLog.findUniqueOrThrow({where:{id:`kp-contract-operation:${contractRequest.operationId}`}});
  const contractView=parseJournalPresentation(receipt.presentation);assert.ok(contractView);
  const subjectChange=contractView.changes.find(change=>change.path==='subject');
  assert.ok(subjectChange,'JOURNAL225_CONTRACT_SUBJECT_CHANGE_RECORDED');
  assert.equal(subjectChange.before,originalContractText,'JOURNAL225_CONTRACT_FULL_OLD_SUBJECT');
  assert.equal(subjectChange.after,contractText,'JOURNAL225_CONTRACT_FULL_NEW_SUBJECT');
  const raw=receipt.newValue;
  await workflow.saveDraft(binding,contractRequest);
  assert.deepEqual((await tx.changeLog.findUniqueOrThrow({where:{id:receipt.id}})).newValue,raw);
  assert.equal(saved.contractId,contractView.entity.id);

  await promoteProjectDrafts(tx,actor,created.result.projectId,new Date());
  const promotion=await tx.changeLog.findFirstOrThrow({where:{entity:'product',entityId:productId,action:'status'}});
  assert.equal(parseJournalPresentation(promotion.presentation)?.actor.type,'system');
  const project=await tx.project.findUniqueOrThrow({where:{id:created.result.projectId}});
  const children=await tx.product.findMany({where:{projectId:project.id}});
  const deleted=await softDeleteProjectCore(tx,actor,{projectId:project.id,clientMutationId:randomUUID(),expectedUpdatedAt:project.updatedAt.toISOString(),expectedProductsVersion:projectProductsVersion(children)});
  assert.equal(deleted.ok,true);
  const productDeletion=await tx.changeLog.findFirstOrThrow({where:{entity:'product',entityId:productId,action:'soft-delete'}});
  assert.deepEqual(parseJournalPresentation(productDeletion.presentation)?.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:productId}]);

  const beforeFault=await tx.project.count({where:{createdById:actor.id}});
  await tx.$executeRawUnsafe('SAVEPOINT journal225_audit_fault');
  const failing=new Proxy(tx,{get(target,key){
    if(key==='changeLog')return new Proxy(target.changeLog,{get(delegate,method){if(method==='create')return async()=>{throw Error('JOURNAL225_AUDIT_FAULT');};return Reflect.get(delegate,method);}});
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  await assert.rejects(()=>createProjectInTransaction(failing,actor,{title:`${prefix}_fault`,clientId:temporaryId}),/JOURNAL225_AUDIT_FAULT/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT journal225_audit_fault');
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT journal225_audit_fault');
  assert.equal(await tx.project.count({where:{createdById:actor.id}}),beforeFault);
  return {ok:true,scenario:'journal-225',checks:['full-proposal-diff','full-contract-diff','system-actor','exact-product-context','unchanged-raw-receipts','no-replay-events','quantity-work-material-audit','quantity-stable-number','quantity-plan-facts-preserved','quantity-audit-rollback','cascade-delete-events','audit-fault-rollback'],projectId:project.id,productId};
}
