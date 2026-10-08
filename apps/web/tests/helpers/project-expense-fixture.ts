import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

/** Owned read fixtures; no action/effect dispatch, no real cash account. */
export async function createExpenseLedgerFixture(tx: Prisma.TransactionClient, marker: string) {
  const user = await tx.user.create({ data: { id: marker, name: "QA101 Снабженец", email: `${marker}@invalid.local`, passwordHash: "qa-login-disabled", roles: ["ACCOUNTANT"] } });
  const client = await tx.client.create({ data: { id: `${marker}-client`, name: marker, phone: "QA" } });
  const max = await tx.project.aggregate({ _max: { numberInt: true } });
  const number = (max._max.numberInt ?? 0) + 1;
  const project = await tx.project.create({ data: { id: `${marker}-project`, number: String(number), numberInt: number, title: marker, clientId: client.id } });
  const product = await tx.product.create({ data: { id: `${marker}-product`, number: `${number}.1`, title: marker, description: "PRIVATE_TECH_QA101", projectId: project.id, expectedPrice: 1000 } });
  const material = await tx.material.create({ data: { id: `${marker}-material`, name: "QA101 Петля", unit: "шт", purchasePrice: 20 } });
  const maxArticle = await tx.expenseArticle.aggregate({ _max: { code: true } });
  const article = await tx.expenseArticle.create({ data: { id: `${marker}-article`, name: "QA101 Доставка", code: (maxArticle._max.code ?? 0) + 1 } });
  await tx.payment.create({ data: { id: `${marker}-payment`, direction: "EXPENSE", projectId: project.id, projectAmount: 10, bynAmount: 10, amount: 10, rate: 1, currency: "BYN", expenseArticleId: article.id, createdById: user.id, comment: marker } });
  const issue = await tx.stockMovement.create({ data: { id: `${marker}-issue`, productId: product.id, materialId: material.id, type: "EXPENSE", quantity: 3, unitPrice: 20, totalByn: 60, createdById: user.id, comment: marker } });
  await tx.warehouseMovementValuation.create({ data: { id: `${marker}-valuation`, movementId: issue.id, runId: marker, clientMutationId: randomUUID(), requestFingerprint: marker, actorId: user.id, quantity: 3, unitCost: "20.000000001", valueByn: "60.000000003", moneyByn: 60 } });
  const returned = await tx.stockMovement.create({ data: { id: `${marker}-return`, productId: product.id, materialId: material.id, type: "RETURN", quantity: 1, unitPrice: 20, totalByn: 20, createdById: user.id, comment: marker } });
  await tx.warehouseMovementValuation.create({ data: { id: `${marker}-return-valuation`, movementId: returned.id, sourceMovementId: issue.id, runId: marker, clientMutationId: randomUUID(), requestFingerprint: marker, actorId: user.id, quantity: 1, unitCost: "20.000000001", valueByn: "20.000000001", moneyByn: 20 } });
  return { user, client, project, product, material, article, issue, returned };
}
export async function deleteExpenseLedgerFixture(tx: Prisma.TransactionClient, marker: string) {
  await tx.warehouseMovementValuation.deleteMany({ where: { runId: marker } });
  await tx.stockMovement.deleteMany({ where: { createdById: marker, comment: marker } });
  await tx.payment.deleteMany({ where: { createdById: marker, comment: marker } });
  await tx.expenseArticle.deleteMany({ where: { id: `${marker}-article` } });
  await tx.material.deleteMany({ where: { id: `${marker}-material` } });
  await tx.product.deleteMany({ where: { id: `${marker}-product`, title: marker } });
  await tx.project.deleteMany({ where: { id: `${marker}-project`, title: marker } });
  await tx.client.deleteMany({ where: { id: `${marker}-client`, name: marker } });
  await tx.user.deleteMany({ where: { id: marker, email: `${marker}@invalid.local` } });
}

