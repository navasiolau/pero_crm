import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {Prisma} from '@prisma/client';
import { createProposalInTransaction, saveProposalInTransaction } from "../src/server/kp/proposal-core";
import { promoteProjectDrafts } from "../src/server/products/draft-core";
import {patchProductCore} from '../src/server/products/core';
import { createContractWorkflow } from "../src/server/kp/contract-workflow";
import { proposalFixture, type FixtureRow } from "./helpers/kp-proposal-fixture";
import { contractActor, contractWorkflowFixture } from "./helpers/contract-workflow-fixture";
import {applyProjectionInTransaction} from '../src/server/kp/pricing-persistence';
import {projectProposalPricing} from '../src/server/kp/pricing';

const actor = { id: "journal-manager", name: "Менеджер журнала", roles: ["MANAGER" as const], source: "web" as const };
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function presentation(log: FixtureRow | undefined) { assert.ok(log); return record(log.presentation); }

test("КП сохраняет полные бизнес-снимки отдельно от прежней квитанции и replay не добавляет события", async () => {
  const f = proposalFixture();
  const input = { operationId: randomUUID(), state: { order: { project: "Журнал" }, items: [{ name: "Шкаф", qty: 1 }], notes: "Первое описание" } };
  const initial = await f.transaction(tx => createProposalInTransaction(tx, actor, input, f.hooks));
  const longText = "Полное описание ".repeat(90) + "конечное значение";
  const request = { operationId: randomUUID(), proposalId: initial.result.proposalId,
    expectedRevision: initial.result.revision, state: { ...initial.result.state, notes: longText } };
  const saved = await f.transaction(tx => saveProposalInTransaction(tx, actor, request, f.hooks));
  const audit = f.state.logs.find(log => log.entity === "commercialProposal" && log.action === "update");
  const view = presentation(audit);
  assert.ok(JSON.stringify(view.changes).includes(longText));
  assert.ok(JSON.stringify(view.changes).includes("Первое описание"));
  assert.equal(record(view.actor).type, "user");
  assert.deepEqual((view.contexts as {kind:string;id:string}[]).map(({kind,id})=>({kind,id})), [{kind:"project",id:initial.result.projectId}]);
  assert.deepEqual(audit!.oldValue, { revision: initial.result.revision });
  assert.deepEqual(audit!.newValue, { revision: saved.result.revision, projectId: saved.result.projectId, itemIds: saved.result.items.map(item => item.id) });
  const before = f.cloneState();
  await f.transaction(tx => saveProposalInTransaction(tx, actor, request, f.hooks));
  assert.deepEqual({...f.cloneState(),sql:before.sql}, before);
});

test("создание из КП и автоматическое продвижение черновика принадлежат Системе без изменения raw actor", async () => {
  const f = proposalFixture();
  const created = await f.transaction(tx => createProposalInTransaction(tx, actor,
    { operationId: randomUUID(), state: { order: { project: "Заказ" }, items: [{name:"Тумба",qty:1}] } }, f.hooks));
  for (const entity of ["project", "product"]) {
    const audit = f.state.logs.find(log => log.entity === entity && log.action === "create");
    const view = presentation(audit);
    assert.equal(record(view.actor).type, "system"); assert.equal(record(view.initiator).id, actor.id);
    assert.equal(audit!.actorId, actor.id); assert.equal(audit!.actorType, "user");
  }
  await f.transaction(tx => promoteProjectDrafts(tx, actor, created.result.projectId, new Date("2026-11-16T12:00:00Z")));
  const status = f.state.logs.find(log => log.entity === "product" && log.action === "status");
  const view = presentation(status);
  assert.equal(record(view.actor).type, "system"); assert.equal(record(view.initiator).id, actor.id);
  assert.deepEqual((view.contexts as {kind:string;id:string}[]).map(({kind,id})=>({kind,id})), [{kind:"product",id:created.result.items[0].productId}]);
  assert.equal(status!.oldValue, "DRAFT"); assert.equal(status!.newValue, "PREPARATION");
});

test("сохранение договора передаёт сравнение независимо от receipt и сохраняет прежний replay", async () => {
  const f = contractWorkflowFixture(), workflow = createContractWorkflow(f.ports);
  const form = await workflow.form(contractActor, "cp_a");
  const captures: unknown[][] = [];
  const original = f.tx.writeReceipt;
  f.tx.writeReceipt = async (...args) => { captures.push(args); await original(...args); };
  const request = {documentId:"cp_a", expectedRevision:form.revision, sourceRefs:form.sourceRefs,
    clientBaseline:form.clientBaseline, operationId:randomUUID(), settings:{...form.settings,subject:"Длинное условие ".repeat(100)}};
  const saved = await workflow.saveDraft(contractActor, request);
  assert.equal(captures.length, 1);
  const hints = record(captures[0][5]);
  assert.ok(JSON.stringify(hints.after).includes(request.settings.subject));
  assert.deepEqual(record(captures[0][4]).result, saved);
  await workflow.saveDraft(contractActor, request);
  assert.equal(captures.length, 1);
});

test('отказ обязательного аудита откатывает КП, проект и изделия вместе',async()=>{
  const f=proposalFixture();
  const initial=await f.transaction(tx=>createProposalInTransaction(tx,actor,{operationId:randomUUID(),state:{order:{project:'До'},items:[{name:'Изделие',qty:1}]}},f.hooks));
  const original=f.tx.changeLog.create;
  f.tx.changeLog.create=(async args=>{
    if(args.data.entity==='commercialProposal'&&args.data.action==='update')throw Error('AUDIT_UNAVAILABLE');
    return original(args);
  }) as typeof original;
  const before=f.cloneState();
  await assert.rejects(()=>f.transaction(tx=>saveProposalInTransaction(tx,actor,{operationId:randomUUID(),proposalId:initial.result.proposalId,
    expectedRevision:initial.result.revision,state:{...initial.result.state,order:{project:'После'},items:initial.result.state.items.map(item=>({...item,name:'Изменённое изделие'}))}},f.hooks)),/AUDIT_UNAVAILABLE/);
  assert.deepEqual(f.cloneState(),before);
});

test('одинаковые Decimal цены не создают событий изделия и пустого изменения проекта',async()=>{
  const projection=projectProposalPricing({currency:'BYN',items:[{id:'item',name:'Изделие',qty:1,price:100}]},{currency:'BYN',value:'1',date:'2026-11-16',source:'MANUAL'});
  const project={id:'project',number:'203',stage:'LEAD',...projection.project};
  const product={id:'product',number:'203.1',quantity:1,initialPrice:new Prisma.Decimal('100.00'),expectedPrice:new Prisma.Decimal('100'),initialPriceCaptureEligible:false};
  const logs:Record<string,unknown>[]=[];
  const tx={$queryRaw:async()=>[project],product:{findMany:async()=>[product],updateMany:async()=>({count:1})},project:{updateMany:async()=>({count:1})},
    changeLog:{create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}}} as unknown as Prisma.TransactionClient;
  await applyProjectionInTransaction(tx,{proposalId:'proposal',project,items:[{id:'item',productId:'product'}],actor},projection);
  assert.equal(logs.filter(log=>log.entity==='product').length,0);
  assert.equal(record(logs[0].presentation).kind,'receipt');
  projection.items[0].expectedPrice=new Prisma.Decimal('101');
  await applyProjectionInTransaction(tx,{proposalId:'proposal',project,items:[{id:'item',productId:'product'}],actor},projection);
  assert.equal(logs.filter(log=>log.entity==='product').length,1);
  const changed=record(logs.find(log=>log.entity==='product')!.presentation);
  assert.equal(record(changed.actor).type,'system');
  assert.deepEqual((changed.contexts as {kind:string;id:string}[]).map(({kind,id})=>({kind,id})),[{kind:'product',id:'product'}]);
});

test('изменение количества из КП журналирует только реальные пересчёты работ и материалов с окончательным номером изделия',async()=>{
  const f=proposalFixture();
  const created=await f.transaction(tx=>createProposalInTransaction(tx,actor,{operationId:randomUUID(),state:{order:{project:'Партия'},items:[{name:'Первое',qty:1},{name:'Второе',qty:1}]}},f.hooks));
  const productId=created.result.items[0].productId;
  f.state.works.push({id:'work',productId,title:'Сборка',paymentKind:'LEGACY',quantity:'2.00',quantityPerUnit:'2.00',priceSnapshot:'10.00',total:'20.00',tasks:[]},
    {id:'zero-work',productId,title:'Нулевая прежняя норма',paymentKind:'LEGACY',quantity:'0.00',quantityPerUnit:'0.00',priceSnapshot:'10.00',total:'0.00',tasks:[]});
  f.state.materials.push({id:'norm',productId,materialId:'hardware',quantity:'3.000',quantityPerUnit:'3.000',issuedQty:'1.000',material:{name:'Петли'}});
  const [first,second]=created.result.state.items;
  const request={operationId:randomUUID(),proposalId:created.result.proposalId,expectedRevision:created.result.revision,
    state:{...created.result.state,items:[second,{...first,qty:2}]}};
  const saved=await f.transaction(tx=>saveProposalInTransaction(tx,actor,request,f.hooks));
  assert.equal(f.state.works.find(row=>row.id==='work')!.total,'40.00');assert.equal(f.state.materials[0].quantity,'6.000');assert.equal(f.state.materials[0].issuedQty,'1.000');
  for(const [entity,id,label] of [['work','work','Сборка'],['projectMaterial','norm','Петли']] as const){
    const log=f.state.logs.find(log=>log.entity===entity&&log.entityId===id);assert.ok(log,'Пересчитанная строка должна иметь событие');
    const view=presentation(log);assert.equal(record(view.actor).type,'system');assert.equal(record(view.initiator).id,actor.id);
    assert.deepEqual(log.oldValue,entity==='work'?{quantity:'2',quantityPerUnit:'2',total:'20'}:{quantity:'3',quantityPerUnit:'3'});
    assert.deepEqual(log.newValue,entity==='work'?{quantity:'4',quantityPerUnit:'2',total:'40'}:{quantity:'6',quantityPerUnit:'3'});
    assert.equal(record(view.entity).label,label);
    assert.deepEqual((view.contexts as {kind:string;id:string;label:string}[]).map(({kind,id,label})=>({kind,id,label})),[{kind:'product',id:productId,label:`Изделие ${created.result.number}.2`}]);
    assert.ok(!JSON.stringify(view).includes('__kp_sync'));
  }
  assert.equal(f.state.logs.filter(log=>log.entityId==='zero-work').length,0,'Нулевая неизменившаяся строка не создаёт событие');
  const count=f.state.logs.length;await f.transaction(tx=>saveProposalInTransaction(tx,actor,request,f.hooks));assert.equal(f.state.logs.length,count);
  const before=f.cloneState(),original=f.tx.changeLog.create;
  f.tx.changeLog.create=(async args=>{if(args.data.entity==='projectMaterial')throw Error('NORMS_AUDIT_FAILED');return original(args);}) as typeof original;
  await assert.rejects(()=>f.transaction(tx=>saveProposalInTransaction(tx,actor,{...request,operationId:randomUUID(),expectedRevision:saved.result.revision,
    state:{...saved.result.state,items:saved.result.state.items.map(item=>item.id===first.id?{...item,qty:3}:item)}},f.hooks)),/NORMS_AUDIT_FAILED/);
  assert.deepEqual(f.cloneState(),before);
  f.tx.changeLog.create=original;
  const patch={productId,field:'quantity' as const,value:3,expectedValue:2,clientMutationId:randomUUID()};
  const manual=await patchProductCore(actor,patch,f.transaction);assert.equal(manual.kind,'saved');
  assert.equal(f.state.works.find(row=>row.id==='work')!.total,'60.00');assert.equal(f.state.materials[0].quantity,'9.000');assert.equal(f.state.materials[0].issuedQty,'1.000');
  const afterManual=f.state.logs.length;await patchProductCore(actor,patch,f.transaction);assert.equal(f.state.logs.length,afterManual);
});
