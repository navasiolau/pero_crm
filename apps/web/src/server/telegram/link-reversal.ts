import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { unlinkTelegramInTransaction } from "./mutation-core";

const schema = z.object({
  linkId: z.string().min(1), generation: z.number().int().nonnegative(),
  mode: z.enum(["revoke", "fresh-link-required"]),
}).strict();

async function load(tx: Prisma.TransactionClient, userId: string, data: z.infer<typeof schema>) {
  if (data.mode !== "revoke") throw new JournalReversalRefusal("Нужна новая привязка в профиле через одноразовый код");
  const link = await tx.telegramLink.findUnique({ where: { userId } });
  if (!link?.chatId || !link.linkedAt || link.revokedAt || link.id !== data.linkId || link.generation !== data.generation)
    throw new JournalReversalRefusal("Привязка изменилась после записи");
}

export const telegramLinkReversal = defineJournalReversal({
  kind: "account.telegram-link", version: 1, schema,
  async preview(ctx, data) { await load(ctx.tx, ctx.entityId, data); return null; },
  async apply(ctx, data) {
    await ctx.tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.entityId} FOR UPDATE`;
    await load(ctx.tx, ctx.entityId, data);
    const result = await unlinkTelegramInTransaction(ctx.tx, ctx.actor, ctx.entityId, { reversal: true });
    if (!result.deleted) throw new JournalReversalRefusal("Привязка уже отозвана");
    return { oldValue: { linked: true }, newValue: { linked: false }, cachePaths: ["/settings/users", "/notifications"],
      inverse: { ...data, generation: data.generation + 1, mode: "fresh-link-required" as const } };
  },
});
