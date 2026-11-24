import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import type * as ProposalCore from "../../src/server/kp/proposal-core";
import { fixedProposalRate } from "../../src/server/kp/pricing-contract";
import { createProposalSaveHooks } from "../../src/server/kp/save-hooks";

/** Проверка на синтетических строках внутри rollback-транзакции вызывающего теста. */
export async function verifyLeadReleaseSave(tx: Prisma.TransactionClient, actor: DomainActor, core: typeof ProposalCore) {
  const temporary = await tx.client.create({ data: { name: "Временный", phone: "QA275" } });
  const customer = await tx.client.create({ data: { name: "Клиент QA275", phone: "QA275" } });
  const rate = fixedProposalRate({ currency: "RUB", value: "0.035612", source: "NBRB", date: "2026-08-18" }, "RUB");
  const hooks = { ...createProposalSaveHooks(rate), applyMedia: undefined, environment: { PERO_KP_TEMP_CLIENT_ID: temporary.id } };
  const { result } = await core.createProposalInTransaction(tx, actor, { operationId: randomUUID(), clientId: customer.id,
    state: { currency: "₽", order: { project: "КП QA275", date: "18.08.2026" }, items: [{ name: "Лестница QA275", qty: 1, price: 10000 }] } }, hooks);
  const proposalId = result.proposalId, projectId = result.projectId, item = result.items[0], productId = item.productId;
  await tx.commercialProposal.update({ where: { id: proposalId }, data: { sourceId: "legacy-r2:qa:" + randomUUID(), rate: null, rateDate: null, rateSource: null } });
  await tx.proposalItem.update({ where: { id: item.id }, data: { productId: null } });
  const file = await tx.file.create({ data: { projectId, productId, fileName: "QA275.txt", storedName: "qa275-" + randomUUID(), mimeType: "text/plain", size: 1 } });
  const work = await tx.work.create({ data: { projectId, productId, title: "Работа QA275", quantity: 1, priceSnapshot: 5, total: 5 } });
  const history = await tx.productStatusHistory.findMany({ where: { productId } });
  const command = { operationId: randomUUID(), proposalId, expectedRevision: result.revision, state: result.state };
  const saved = await core.saveProposalInTransaction(tx, actor, command, hooks);
  assert.equal(saved.result.revision, result.revision + 1);
  assert.equal(saved.result.items[0].productId, productId);
  assert.equal((await tx.commercialProposal.findUniqueOrThrow({where:{id:proposalId}})).rate?.toString(), "0.035612");
  assert.equal((await tx.file.findUniqueOrThrow({where:{id:file.id}})).productId, productId);
  assert.equal((await tx.work.findUniqueOrThrow({where:{id:work.id}})).productId, productId);
  assert.deepEqual(await tx.productStatusHistory.findMany({where:{productId}}), history);
  assert.equal(await tx.product.count({where:{projectId,deletedAt:null}}), 1);
  assert.equal((await core.saveProposalInTransaction(tx, actor, command, hooks)).result.repeated, true);
}
