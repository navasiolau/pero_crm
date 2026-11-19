import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  userId: z.string().min(1), type: z.string().min(1).max(100).refine(type => type !== "plan.reminder"),
  before: z.boolean(), after: z.boolean(), revision: z.number().int().nonnegative(),
}).strict();

async function load(tx: Prisma.TransactionClient, entityId: string, data: z.infer<typeof schema>) {
  if (entityId !== `${data.userId}:${data.type}`) throw new JournalReversalRefusal("Настройка не найдена", "/notifications");
  const row = await tx.notificationPreference.findUnique({ where: { userId_type: { userId: data.userId, type: data.type } } });
  if (!row || row.enabled !== data.after || row.revision !== data.revision)
    throw new JournalReversalRefusal("Настройка уведомлений уже изменилась", "/notifications");
}

export const notificationPreferenceReversal = defineJournalReversal({
  kind: "account.notification-preference", version: 1, schema,
  async preview(ctx, data) { await load(ctx.tx, ctx.entityId, data); return null; },
  async apply(ctx, data) {
    await ctx.tx.$queryRaw`SELECT id FROM "User" WHERE id = ${data.userId} FOR UPDATE`;
    await load(ctx.tx, ctx.entityId, data);
    const updated = await ctx.tx.notificationPreference.update({ where: { userId_type: { userId: data.userId, type: data.type } },
      data: { enabled: data.before, revision: { increment: 1 } } });
    return { oldValue: data.after, newValue: updated.enabled, cachePaths: ["/notifications"],
      inverse: { ...data, before: data.after, after: updated.enabled, revision: updated.revision } };
  },
});
