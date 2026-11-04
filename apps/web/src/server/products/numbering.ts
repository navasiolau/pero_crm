import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";

export type ProductNumberChange = { id: string; previousNumber: string; number: string };
type NumberedProduct = { id: string; number: string; suffixInt: number | null; createdAt: Date };

/** До переиспользования номера закрепляем внутреннюю ссылку за исходным изделием. */
export async function stabilizeProductNumberLinks(tx: Prisma.TransactionClient, products: readonly { id: string; number: string }[]) {
  for (const product of products) {
    const previous = `/products/${encodeURIComponent(product.number)}`;
    const stable = `/products/${encodeURIComponent(product.id)}`;
    await tx.$executeRaw`UPDATE "Notification" SET link = ${stable} || substring(link FROM ${previous.length + 1}::integer)
      WHERE link = ${previous} OR left(link, ${previous.length + 1}::integer) IN (${previous + "?"}, ${previous + "#"})`;
  }
}

/** Project уже заблокирован вызывающей операцией; порядок не зависит от UI-фильтров. */
export async function renumberActiveProductsInTransaction(
  tx: Prisma.TransactionClient, actor: DomainActor, project: { id: string; number: string },
): Promise<ProductNumberChange[]> {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId" = ${project.id} AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`;
  const products = await tx.product.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: { id: true, number: true, suffixInt: true, createdAt: true },
  });
  products.sort((a: NumberedProduct, b: NumberedProduct) => (a.suffixInt ?? Infinity) - (b.suffixInt ?? Infinity)
    || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const changed = products.flatMap((product, index) => {
    const suffixInt = index + 1, number = `${project.number}.${suffixInt}`;
    return product.number === number && product.suffixInt === suffixInt ? [] : [{ product, suffixInt, number }];
  });
  await stabilizeProductNumberLinks(tx, changed.map(({ product }) => product));
  const prefix = `__product_number_${randomUUID()}_`;
  // Partial UNIQUE проверяется сразу: освобождаем номера перед их новым назначением.
  for (const { product } of changed) await tx.product.update({ where: { id: product.id }, data: { number: `${prefix}${product.id}` } });
  for (const { product, suffixInt, number } of changed) {
    await tx.product.update({ where: { id: product.id }, data: { number, suffixInt } });
    await tx.changeLog.create({ data: {
      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "product", entityId: product.id, action: "number.change", field: "number",
      oldValue: { number: product.number, suffixInt: product.suffixInt }, newValue: { number, suffixInt },
    } });
  }
  return changed.map(({ product, number }) => ({ id: product.id, previousNumber: product.number, number }));
}
