import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { applyProductNumberMoves, stabilizeProductNumberLinks, type ProductNumberChange } from "@/server/products/numbering";
import { projectJournalContext, productJournalContext } from "./journal";

const number = z.object({ number: z.string(), suffixInt: z.number().int().nullable() });
const common = { visible: z.boolean(), stamp: z.string().datetime(), dependencies: z.string().optional() };
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), ...common, products: z.array(z.string()) }),
  z.object({ kind: z.literal("product"), ...common, projectId: z.string(), composition: z.string(),
    moves: z.array(z.object({ id: z.string(), from: number, to: number })) }),
]);
type Command = z.infer<typeof schema>;
type Tx = Prisma.TransactionClient;

export function readActiveNumbers(tx: Tx, projectId: string) {
  return tx.product.findMany({ where: { projectId, deletedAt: null }, orderBy: { id: "asc" },
    select: { id: true, number: true, suffixInt: true } });
}
type Numbers = Awaited<ReturnType<typeof readActiveNumbers>>;
const composition = (rows: Numbers) => createHash("sha256").update(JSON.stringify(rows.map(row =>
  [row.id, row.number, row.suffixInt]))).digest("hex");

export function projectVisibilityCommand(visible: boolean, stamp: Date, products: string[], dependencies?: string) {
  return cardVisibilityReversal.command({ kind: "project", visible, stamp: stamp.toISOString(), products,
    ...(dependencies ? { dependencies } : {}) });
}

export async function productVisibilityCommand(tx: Tx, projectId: string, visible: boolean, stamp: Date, before: Numbers,
  changes: readonly ProductNumberChange[], dependencies?: string) {
  const after = await readActiveNumbers(tx, projectId);
  const oldNumbers = new Map(before.map(product => [product.id, product]));
  const newNumbers = new Map(after.map(product => [product.id, product]));
  const moves = changes.map(({ id }) => {
    const old = oldNumbers.get(id), next = newNumbers.get(id);
    if (!old || !next) throw Error("Изменился состав изделий при нумерации");
    return { id, from: { number: next.number, suffixInt: next.suffixInt }, to: { number: old.number, suffixInt: old.suffixInt } };
  });
  return cardVisibilityReversal.command({ kind: "product", projectId, visible, stamp: stamp.toISOString(), composition: composition(after), moves,
    ...(dependencies ? { dependencies } : {}) });
}

export async function cardDependencies(tx: Tx, kind: Command["kind"], id: string) {
  const result = kind === "project"
    ? await tx.project.findUniqueOrThrow({ where: { id }, select: { _count: true, commercialProposal: { select: { id: true } } } })
    : await tx.product.findUniqueOrThrow({ where: { id }, select: { _count: true, proposalItem: { select: { id: true } } } });
  // Действующий состав изделий сверяется отдельно; снятая позиция может оставаться в истории проекта.
  const counts = Object.entries(result._count).filter(([key, value]) => value > 0 && !(kind === "project" && key === "products"))
    .sort(([a], [b]) => a.localeCompare(b));
  const binding = "commercialProposal" in result ? result.commercialProposal?.id : result.proposalItem?.id;
  return createHash("sha256").update(JSON.stringify([counts, binding ?? null])).digest("hex");
}

const stateFields = { id: true, number: true, title: true, updatedAt: true, deletedAt: true } as const;
async function check(tx: Tx, id: string, data: Command) {
  if (data.dependencies && data.dependencies !== await cardDependencies(tx, data.kind, id))
    throw new JournalReversalRefusal("У карточки появились зависимые записи", `/${data.kind === "project" ? "projects" : "products"}/${encodeURIComponent(id)}`);
  if (data.kind === "project") {
    const project = await tx.project.findUnique({ where: { id }, select: stateFields });
    if (!project || Boolean(project.deletedAt) !== data.visible || project.updatedAt.toISOString() !== data.stamp)
      throw new JournalReversalRefusal("Проект изменился после этого действия", `/projects/${encodeURIComponent(id)}`);
    const matching = await tx.product.count({ where: { projectId: id, id: { in: data.products },
      updatedAt: new Date(data.stamp), deletedAt: data.visible ? new Date(data.stamp) : null } });
    const live = await tx.product.count({ where: { projectId: id, deletedAt: null } });
    if (matching !== data.products.length || live !== (data.visible ? 0 : data.products.length))
      throw new JournalReversalRefusal("Состав проекта изменился после этого действия", `/projects/${encodeURIComponent(id)}?tab=products`);
    return project;
  }
  const product = await tx.product.findUnique({ where: { id }, select: { ...stateFields, projectId: true, project: { select: { deletedAt: true } } } });
  const href = `/projects/${encodeURIComponent(data.projectId)}?tab=products`;
  if (!product || product.projectId !== data.projectId || product.project.deletedAt ||
      Boolean(product.deletedAt) !== data.visible || product.updatedAt.toISOString() !== data.stamp)
    throw new JournalReversalRefusal("Изделие или его проект изменились после этого действия", href);
  if (composition(await readActiveNumbers(tx, data.projectId)) !== data.composition)
    throw new JournalReversalRefusal("После этого действия изменились состав или номера изделий", href);
  return product;
}

export const cardVisibilityReversal = defineJournalReversal<Command>({
  kind: "card.visibility", version: 1, schema,
  async preview({ tx, entityId }, data) {
    await check(tx, entityId, data);
    return null;
  },
  async apply({ tx, actor, entityId, reversalId }, data) {
    const projectId = data.kind === "project" ? entityId : data.projectId;
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId" = ${projectId} ORDER BY id FOR UPDATE`;
    const card = await check(tx, entityId, data);
    const stamp = new Date(Math.max(Date.now(), card.updatedAt.getTime() + 1));
    const state = { updatedAt: stamp, deletedAt: data.visible ? null : stamp, deletedById: data.visible ? null : actor.id };
    const inverse = { ...data, visible: !data.visible, stamp: stamp.toISOString() };
    if (data.kind === "project") {
      await tx.project.update({ where: { id: entityId }, data: state });
      await tx.product.updateMany({ where: { projectId: entityId, id: { in: data.products } }, data: state });
    } else if (inverse.kind === "product") {
      if (!data.visible) {
        await stabilizeProductNumberLinks(tx, [card]);
        await tx.product.update({ where: { id: entityId }, data: state });
      }
      await applyProductNumberMoves(tx, actor, data.moves.map(move => ({
        product: { id: move.id, ...move.from }, ...move.to,
      })), reversalId);
      if (data.visible) await tx.product.update({ where: { id: entityId }, data: state });
      inverse.composition = composition(await readActiveNumbers(tx, projectId));
      inverse.moves = data.moves.map(move => ({ id: move.id, from: move.to, to: move.from }));
    }
    const context = data.kind === "project" ? projectJournalContext(card) : productJournalContext(card);
    const snapshot = { id: card.id, number: card.number, title: card.title };
    return { inverse, hints: { ...context, before: data.visible ? null : snapshot, after: data.visible ? snapshot : null },
      cachePaths: ["/projects", "/products", "/finance/projects", `/projects/${encodeURIComponent(projectId)}`,
        `/finance/projects/${encodeURIComponent(projectId)}`, ...(data.kind === "product" ? [`/products/${encodeURIComponent(card.number)}`] : [])] };
  },
});
