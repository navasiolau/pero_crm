import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { canAssignExpenseProject } from "@/lib/expense-project-assignment";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { journalProductContext, journalProjectContext } from "@/server/finance/journal";
import { activePaymentWhere } from "@/server/payments/active-records";
import type { DomainActor } from "@/server/actor";
import { decimalText } from "@/lib/product-quantity";
import { quantityAtoms, quantityInput } from "@/lib/warehouse-cost";
import { lockProductRow } from "@/server/products/quantity-core";
import { warehouseMove, warehouseReadPositions, warehouseWriteGate } from "./accounting";
import { activeStockMovementWhere } from "./active-records";
import { expenseIssueProductWhere, requireExpenseIssueRole } from "./expense-issue-access";
import { expenseIssueConfirmInput, expenseIssueInput, expenseIssueQuantities, receiptLineQuantities, type ExpenseIssueInput } from "./expense-issue-contracts";
import { expenseReceiptIssueReversal } from "./expense-issue-reversal";

const optionInput = z.object({ paymentId: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional() }).strict();
const movementSelect = { id: true, type: true, receiptKind: true, deletionId: true, quantity: true, materialId: true,
  material: { select: { name: true, measurementUnit: { select: { name: true } } } },
} satisfies Prisma.StockMovementSelect;
type SourceMovement = Prisma.StockMovementGetPayload<{ select: typeof movementSelect }>;

export async function loadReceiptIssueSources(tx: Prisma.TransactionClient, paymentId: string) {
  const source = await tx.payment.findFirst({
    where: { ...activePaymentWhere, id: paymentId, direction: "EXPENSE", logisticsAllocationId: null },
    select: { id: true, stockPurchase: { select: { movement: { select: movementSelect } } },
      expenseReceipts: { where: { cancelledAt: null }, take: 2, select: {
        lines: { orderBy: { position: "asc" }, select: { movement: { select: movementSelect } } },
      } },
    },
  });
  if (!source || source.expenseReceipts.length > 1 || (source.stockPurchase && source.expenseReceipts.length))
    throw Error("Подтверждённый приход недоступен");
  const movements: SourceMovement[] = source.expenseReceipts[0]?.lines.map(line => line.movement) ?? (source.stockPurchase ? [source.stockPurchase.movement] : []);
  if (!movements.length || movements.some(row => row.deletionId || row.type !== "INCOME" || row.receiptKind !== "PAID"))
    throw Error("Подтверждённый приход недоступен");
  const issued = await tx.expenseReceiptIssueLine.findMany({
    where: { sourceMovementId: { in: movements.map(row => row.id) }, issue: { paymentId, cancelledAt: null },
      movement: { ...activeStockMovementWhere, type: "EXPENSE" } },
    select: { sourceMovementId: true, movement: { select: { quantity: true, warehouseValuation: { select: { returnedQuantity: true } } } } },
  });
  const sums = new Map<string, bigint>();
  for (const row of issued) {
    const value = row.movement.warehouseValuation;
    if (!value) throw Error("Выдача не согласована со складским учётом");
    const remaining = quantityAtoms(row.movement.quantity.toString()) - quantityAtoms(value.returnedQuantity.toString());
    if (remaining < BigInt(0)) throw Error("Возврат не согласован с выдачей");
    sums.set(row.sourceMovementId, (sums.get(row.sourceMovementId) ?? BigInt(0)) + remaining);
  }
  return movements.map(row => ({ movementId: row.id, materialId: row.materialId, materialName: row.material.name,
    unit: row.material.measurementUnit.name, ...receiptLineQuantities(row.quantity.toString(), decimalText(sums.get(row.id) ?? BigInt(0), 3)) }));
}

export async function loadExpenseIssueChoices(tx: Prisma.TransactionClient, actor: DomainActor, raw: unknown) {
  requireExpenseIssueRole(actor);
  const { paymentId, projectId } = optionInput.parse(raw);
  const sources = await loadReceiptIssueSources(tx, paymentId);
  if (projectId) {
    const products = await tx.product.findMany({ where: expenseIssueProductWhere(actor, projectId),
      select: { id: true, number: true, title: true }, orderBy: { number: "asc" } });
    return { sources, choices: products.map(row => ({ id: row.id, label: row.number + " · " + row.title })) };
  }
  const projects = await tx.project.findMany({ where: { deletedAt: null, products: { some: expenseIssueProductWhere(actor) } },
    select: { id: true, number: true, title: true }, orderBy: { numberInt: "desc" } });
  return { sources, choices: projects.map(row => ({ id: row.id, label: row.number + " · " + row.title })) };
}

async function readTarget(tx: Prisma.TransactionClient, actor: DomainActor, input: ExpenseIssueInput) {
  const product = await tx.product.findFirst({
    where: { id: input.productId, AND: [expenseIssueProductWhere(actor, input.projectId)] },
    select: { id: true, number: true, title: true, project: { select: { id: true, number: true } } },
  });
  if (!product) throw Error("Действующее изделие выбранного проекта недоступно");
  return product;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizedIssue(raw: ExpenseIssueInput) {
  const { paymentId, projectId, productId } = raw;
  const lines = raw.lines.map(row => ({ sourceMovementId: row.sourceMovementId, quantity: quantityInput(row.quantity) }))
    .sort((a, b) => a.sourceMovementId.localeCompare(b.sourceMovementId));
  return { paymentId, projectId, productId, lines };
}

export async function loadExpenseIssueQuote(tx: Prisma.TransactionClient, actor: DomainActor, raw: unknown) {
  requireExpenseIssueRole(actor);
  const input = normalizedIssue(expenseIssueInput.parse(raw));
  const [sources, product] = await Promise.all([loadReceiptIssueSources(tx, input.paymentId), readTarget(tx, actor, input)]);
  const materials = sources.filter(row => input.lines.some(line => line.sourceMovementId === row.movementId)).map(row => row.materialId);
  const stock = await warehouseReadPositions(tx, materials);
  if (!stock.ready) throw Error("Склад временно закрыт для изменений");
  const lines = expenseIssueQuantities(input.lines, sources, stock.positions);
  const sum = lines.reduce((total, row) => total.plus(row.moneyByn), new Prisma.Decimal(0));
  return { product, lines, totalByn: sum.toFixed(2), fingerprint: digest({ actor: actor.id, input, run: stock.runId, lines }) };
}

export function expenseIssueCachePaths(projectId: string, productId: string) {
  return ["/finance/expenses", "/warehouse/movements", "/warehouse/stock", "/finance/projects", "/changelog",
    `/projects/${encodeURIComponent(projectId)}`, `/finance/projects/${encodeURIComponent(projectId)}`, `/products/${encodeURIComponent(productId)}`];
}

// Вызывается под общим денежным lock. Повтор проверяется до чтения текущего складского остатка.
export async function postExpenseIssueInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, raw: unknown, reversalId?: string) {
  requireExpenseIssueRole(actor);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, roles: true } });
  if (!user?.active || !canAssignExpenseProject(user.roles)) throw Error("Недостаточно прав");
  const data = expenseIssueConfirmInput.parse(raw);
  const input = normalizedIssue(data), requestId = data.requestId.toLowerCase();
  const fingerprint = digest({ input, quote: data.fingerprint });
  const previous = await tx.expenseReceiptIssue.findUnique({ where: { clientMutationId: requestId } });
  if (previous) {
    if (previous.actorId !== actor.id || previous.requestFingerprint !== fingerprint)
      throw Error("Идентификатор запроса уже использован с другими данными");
    if (previous.cancelledAt) throw Error("Выдача отменена");
    return { issueId: previous.id, eventIds: [] as string[], cachePaths: [] as string[] };
  }
  await warehouseWriteGate(tx);
  const sources = await loadReceiptIssueSources(tx, input.paymentId);
  const materialIds = [...new Set(sources.filter(row => input.lines.some(line => line.sourceMovementId === row.movementId)).map(row => row.materialId))].sort();
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${input.projectId} FOR SHARE`;
  if (materialIds.length) await tx.$queryRaw`SELECT id FROM "Material" WHERE id IN (${Prisma.join(materialIds)}) ORDER BY id COLLATE "C" FOR UPDATE`;
  await lockProductRow(tx, input.productId);
  const quote = await loadExpenseIssueQuote(tx, { ...actor, roles: user.roles }, input);
  if (quote.fingerprint !== data.fingerprint) throw Error("Остаток или себестоимость изменились. Рассчитайте выдачу заново");

  const issueId = randomUUID(), journalId = reversalId ?? "expense-issue:" + issueId;
  const { product, lines } = quote;
  await tx.expenseReceiptIssue.create({ data: { id: issueId, paymentId: input.paymentId, projectId: input.projectId,
    productId: input.productId, clientMutationId: requestId, requestFingerprint: fingerprint, actorId: actor.id } });
  const contexts = [journalProjectContext(product.project), journalProductContext(product)];
  if (!reversalId) await writeChangeLogInTransaction(tx, {
    id: journalId, entity: "payment", entityId: input.paymentId, action: "expense-issue.create", actorType: "user",
    actorId: actor.id, actorName: actor.name, source: actor.source, newValue: { issueId, lines },
    reversal: expenseReceiptIssueReversal.command({ kind: "undo", issueId }),
  }, { entity: { label: "Выдача материалов по оплаченному чеку" }, contexts,
    after: { issueId, lines, totalByn: quote.totalByn } });
  const eventIds = [];
  for (const line of lines) {
    const posted = await warehouseMove(tx, { ...actor, roles: user.roles },
      { kind: "EXPENSE", clientMutationId: randomUUID(), materialId: line.materialId, productId: product.id, quantity: line.quantity },
      undefined, { operationRootId: journalId, projectId: input.projectId });
    if (!posted.eventId || !posted.movement.totalByn?.eq(line.moneyByn)) throw Error("Подтверждённая себестоимость изменилась");
    await tx.expenseReceiptIssueLine.create({ data: { issueId, sourceMovementId: line.movementId, movementId: posted.movement.id } });
    eventIds.push(posted.eventId);
  }
  return { issueId, eventIds, cachePaths: expenseIssueCachePaths(input.projectId, input.productId) };
}
