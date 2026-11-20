import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { decodeListPreference, encodeListPreference, isEngineerFilterInitialized, normalizeListQuery } from "@/lib/list-state";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";

const sectionSchema = z.enum(["projects", "products", "organizationExpenses"]);
const schema = z.object({ revisionId: z.string().uuid() }).strict();
const paths = { projects: "/projects", products: "/products", organizationExpenses: "/finance/expenses" } as const;

export function encodedListRevision(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = z.object({ version: z.literal(2), revision: z.string().uuid() }).safeParse(parsed);
    return result.success ? result.data.revision : null;
  } catch { return null; }
}

async function load(tx: Prisma.TransactionClient, entityId: string, revisionId: string) {
  const revision = await tx.savedListChoiceRevision.findUnique({ where: { id: revisionId } });
  const section = sectionSchema.safeParse(revision?.section);
  if (!revision || !section.success || entityId !== `${revision.userId}:${section.data}.list`) {
    throw new JournalReversalRefusal("Сохранённый выбор списка не найден");
  }
  const row = await tx.userPreference.findUnique({ where: { userId_key: { userId: revision.userId, key: `${section.data}.list` } } });
  if (!row || encodedListRevision(row.value) !== revision.afterRevision)
    throw new JournalReversalRefusal("Сохранённый выбор списка уже изменился", paths[section.data]);
  return { revision, row, section: section.data };
}

export const savedListChoiceReversal = defineJournalReversal({
  kind: "account.saved-list-choice", version: 1, schema,
  async preview(ctx, data) { await load(ctx.tx, ctx.entityId, data.revisionId); return null; },
  async apply(ctx, data) {
    const { revision, row, section } = await load(ctx.tx, ctx.entityId, data.revisionId);
    const previous = decodeListPreference(section, row.value);
    if (previous === null) throw new JournalReversalRefusal("Сохранённый выбор списка недоступен");
    const nextRevision = randomUUID();
    const value = encodeListPreference(section, normalizeListQuery(section, revision.beforeQuery), nextRevision, revision.beforeEngineerInitialized);
    const switched = await ctx.tx.userPreference.updateMany({ where: { userId: row.userId, key: row.key, value: row.value },
      data: { value, revision: { increment: 1 } } });
    if (switched.count !== 1) throw new JournalReversalRefusal("Сохранённый выбор списка уже изменился", paths[section]);
    const inverse = await ctx.tx.savedListChoiceRevision.create({
      data: { id: randomUUID(), userId: row.userId, section, beforeQuery: previous,
        beforeEngineerInitialized: isEngineerFilterInitialized(row.value), afterRevision: nextRevision },
    });
    return { oldValue: "Выбор списка сохранён", newValue: "Предыдущий выбор списка восстановлен",
      cachePaths: [paths[section]], inverse: { revisionId: inverse.id } };
  },
});
