import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";

export const viewDefaults = { "tasks.view": "kanban", "my.view": "list" } as const;

const choice = z.enum(["kanban", "table", "list"]);
const schema = z.object({
  userId: z.string().min(1), key: z.enum(["tasks.view", "my.view"]), before: choice, after: choice,
  revision: z.number().int().nonnegative(),
}).strict().refine(({ key, before, after }) => isLegalView(key, before) && isLegalView(key, after));

export function isLegalView(key: string, value: string): boolean {
  return key === "tasks.view" && (value === "kanban" || value === "table") ||
    key === "my.view" && (value === "kanban" || value === "list");
}

async function load(tx: Prisma.TransactionClient, entityId: string, data: z.infer<typeof schema>) {
  if (entityId !== `${data.userId}:${data.key}`) throw new JournalReversalRefusal("Настройка не найдена");
  const row = await tx.userPreference.findUnique({ where: { userId_key: { userId: data.userId, key: data.key } } });
  if (row?.value !== data.after || row.revision !== data.revision) throw new JournalReversalRefusal("Вид раздела уже изменился");
}

export const viewPreferenceReversal = defineJournalReversal({
  kind: "account.view-preference", version: 1, schema,
  async preview(ctx, data) { await load(ctx.tx, ctx.entityId, data); return null; },
  async apply(ctx, data) {
    await ctx.tx.$queryRaw`SELECT id FROM "User" WHERE id = ${data.userId} FOR UPDATE`;
    await load(ctx.tx, ctx.entityId, data);
    const updated = await ctx.tx.userPreference.update({
      where: { userId_key: { userId: data.userId, key: data.key } },
      data: { value: data.before, revision: { increment: 1 } },
    });
    return { oldValue: data.after, newValue: data.before, cachePaths: [data.key === "my.view" ? "/my" : "/tasks"],
      inverse: { ...data, before: data.after, after: data.before, revision: updated.revision } };
  },
});
