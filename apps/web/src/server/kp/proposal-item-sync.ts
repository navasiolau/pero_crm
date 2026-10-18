import { randomUUID } from "node:crypto";
import type { Prisma, Product } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { createProductInTransaction } from "@/server/products/core";
import { recalculateQuantity } from "@/server/products/quantity-core";
import { lockWarehouseMetadata, assertWarehouseMetadataWritable } from "@/server/warehouse/gate";
import { ProposalWriteError, canonicalProposalJson, proposalItemDescription, proposalText,
  type ProposalItemState } from "./proposal-contract";

export type SynchronizedProposalItem = { id: string; productId: string; number: string; position: number; state: ProposalItemState; previousQuantity: number };

const commercialSnapshot = (product: Product) => ({
  number: product.number, suffixInt: product.suffixInt, title: product.title,
  quantity: product.quantity, kind: product.kind, description: product.description,
  deletedAt: product.deletedAt?.toISOString() ?? null,
});

async function auditProductSync(tx: Prisma.TransactionClient, actor: DomainActor,
  proposalId: string, before: Product, after: Product) {
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "product", entityId: after.id, action: "kp.synchronize",
    oldValue: commercialSnapshot(before), newValue: { ...commercialSnapshot(after), proposalId },
  } });
}

/** Проект уже заблокирован; денежные поля применяет следующий hook в этой же tx. */
export async function synchronizeProposalItemsInTransaction(
  tx: Prisma.TransactionClient, actor: DomainActor,
  proposal: { id: string; projectId: string }, project: { number: string },
  items: readonly ProposalItemState[], changedAt: Date,
) {
  const existingItems = await tx.proposalItem.findMany({ where: { proposalId: proposal.id } });
  const existingById = new Map(existingItems.map(item => [item.id, item]));
  const incomingIds = new Set(items.map(item => item.id));
  const unknownIds = items.filter(item => !existingById.has(item.id)).map(item => item.id);
  if (unknownIds.length && await tx.proposalItem.count({ where: { id: { in: unknownIds } } }))
    throw new ProposalWriteError("validation", "Позиция принадлежит другому КП");
  // Shared-lock склада предшествует Product lock даже если количество успело
  // измениться перед ожиданием строки. Фазу проверяем только для реального пересчёта.
  await lockWarehouseMetadata(tx);
  await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId" = ${proposal.projectId} ORDER BY id FOR UPDATE`;
  const products = await tx.product.findMany({ where: { projectId: proposal.projectId }, orderBy: { id: "asc" } });
  const productsById = new Map(products.map(product => [product.id, product]));
  if (items.some(item => {
    const productId = existingById.get(item.id)?.productId;
    return productId && productsById.get(productId)?.quantity !== item.qty;
  })) await assertWarehouseMetadataWritable(tx);
  const retained = new Set<string>();
  for (const item of items) {
    const existing = existingById.get(item.id);
    if (!existing?.productId) continue;
    const product = productsById.get(existing.productId);
    if (!product || product.projectId !== proposal.projectId)
      throw new ProposalWriteError("validation", "Изделие позиции не принадлежит проекту КП");
    retained.add(product.id);
  }

  let changed = false;
  const previousNumbers = new Map<string, string>();
  for (const product of products) {
    if (product.deletedAt || retained.has(product.id)) continue;
    const after = await tx.product.update({ where: { id: product.id }, data: {
      deletedAt: changedAt, deletedById: actor.id,
    } });
    await auditProductSync(tx, actor, proposal.id, product, after);
    previousNumbers.set(product.id, product.number);
    changed = true;
  }
  for (const item of existingItems) {
    if (incomingIds.has(item.id) || item.deletedAt) continue;
    await tx.proposalItem.update({ where: { id: item.id }, data: { deletedAt: changedAt } });
    changed = true;
  }

  // У позиций своё partial UNIQUE(proposalId, position), а CHECK требует > 0.
  // Выбираем свободные положительные слоты вне конечного диапазона 1…N.
  const desiredPositions = new Map(items.map((item, index) => [item.id, index + 1]));
  const movedItems = new Set<string>();
  if (existingItems.some(item => !item.deletedAt && incomingIds.has(item.id) && item.position !== desiredPositions.get(item.id))) {
    const occupied = new Set(existingItems.filter(item => !item.deletedAt).map(item => item.position));
    let candidate = items.length + 1;
    for (const item of existingItems) {
      if (item.deletedAt || !incomingIds.has(item.id)) continue;
      while (occupied.has(candidate)) candidate++;
      if (candidate > 2_147_483_647) throw new ProposalWriteError("validation", "Не удалось выделить временные позиции КП");
      await tx.proposalItem.update({ where: { id: item.id }, data: { position: candidate } });
      occupied.add(candidate++); movedItems.add(item.id);
    }
  }

  // Partial UNIQUE не откладывается: сначала освобождаем все действующие номера.
  const needsRenumber = items.some((item, position) => {
    const productId = existingById.get(item.id)?.productId;
    const product = productId ? productsById.get(productId) : undefined;
    return product && (product.number !== `${project.number}.${position + 1}` || product.deletedAt !== null);
  });
  if (needsRenumber) {
    const temporaryPrefix = `__kp_sync_${randomUUID()}_`;
    for (const productId of retained) {
      await tx.product.update({ where: { id: productId }, data: { number: `${temporaryPrefix}${productId}` } });
    }
  }

  const synchronized: SynchronizedProposalItem[] = [];
  for (const [index, state] of items.entries()) {
    const position = index + 1;
    const existing = existingById.get(state.id);
    let before = existing?.productId ? productsById.get(existing.productId) : undefined;
    const number = `${project.number}.${position}`;
    const data = {
      number, suffixInt: position,
      title: proposalText(state.name).trim() || `Позиция ${position}`,
      quantity: state.qty, kind: proposalText(state.kind).trim() || null,
      description: proposalItemDescription(state), deletedAt: null, deletedById: null,
    };
    let created = false;
    if (!before) {
      const result = await createProductInTransaction(tx, actor, {
        projectId: proposal.projectId, title: data.title, quantity: data.quantity,
        kind: data.kind ?? undefined, description: data.description ?? undefined,
      });
      if (!result.ok) throw new ProposalWriteError("validation", result.error);
      before = result.product;
      created = true;
    }
    const previousQuantity = before.quantity;
    if (before.quantity !== data.quantity) await recalculateQuantity(tx, before, data.quantity);
    const desiredSnapshot = { ...data, deletedAt: null };
    const commercialChanged = canonicalProposalJson(commercialSnapshot(before)) !== canonicalProposalJson({
      number: desiredSnapshot.number, suffixInt: desiredSnapshot.suffixInt, title: desiredSnapshot.title,
      quantity: desiredSnapshot.quantity, kind: desiredSnapshot.kind, description: desiredSnapshot.description,
      deletedAt: desiredSnapshot.deletedAt,
    });
    const after = commercialChanged || (needsRenumber && retained.has(before.id))
      ? await tx.product.update({ where: { id: before.id }, data }) : before;
    if (created || commercialChanged) {
      await auditProductSync(tx, actor, proposal.id, before, after);
      previousNumbers.set(before.id, before.number);
      changed = true;
    }
    if (existing) {
      if (movedItems.has(existing.id) || existing.deletedAt || existing.position !== position || existing.productId !== after.id ||
        canonicalProposalJson(existing.state) !== canonicalProposalJson(state)) {
        await tx.proposalItem.update({ where: { id: state.id }, data: { productId: after.id, position, state, deletedAt: null } });
        changed = true;
      }
    } else {
      await tx.proposalItem.create({ data: {
        id: state.id, proposalId: proposal.id, productId: after.id, position, state,
      } });
      changed = true;
    }
    synchronized.push({ id: state.id, productId: after.id, number, position, state, previousQuantity });
  }
  return { items: synchronized, changed, previousNumbers };
}
