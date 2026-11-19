import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { revokeApiTokenInTransaction } from "./mutation-core";

const path = "/settings/api";
const schema = z.object({ createdAt: z.iso.datetime(), mode: z.enum(["revoke", "fresh-token-required"]) }).strict();

async function eligible(tx: Prisma.TransactionClient, tokenId: string, data: z.infer<typeof schema>) {
  if (data.mode !== "revoke") throw new JournalReversalRefusal("Отозванный ключ не восстанавливается. Выпустите новый API-ключ отдельно.", path);
  const row = await tx.apiToken.findUnique({ where: { id: tokenId } });
  if (!row || row.revokedAt || row.createdAt.toISOString() !== data.createdAt)
    throw new JournalReversalRefusal("API-ключ уже отозван или недоступен", path);
}

export const apiTokenCreationReversal = defineJournalReversal({
  kind: "account.api-token-issue", version: 1, schema,
  confirmation: "Действующий API-ключ будет отозван. Для повторной выдачи доступа нужно отдельно выпустить новый ключ.",
  async preview(ctx, data) { await eligible(ctx.tx, ctx.entityId, data); return null; },
  async apply(ctx, data) {
    await ctx.tx.$queryRaw`SELECT id FROM "ApiToken" WHERE id = ${ctx.entityId} FOR UPDATE`;
    await eligible(ctx.tx, ctx.entityId, data);
    const result = await revokeApiTokenInTransaction(ctx.tx, ctx.actor, ctx.entityId, { reversal: true });
    if (!result.ok || result.noOp || !result.before || !result.after)
      throw new JournalReversalRefusal("API-ключ уже отозван или недоступен", path);
    return { oldValue: result.before, newValue: result.after,
      hints: { reason: "API-ключ отозван окончательно. Повторное предоставление доступа требует выпуска нового ключа." },
      inverse: { createdAt: data.createdAt, mode: "fresh-token-required" as const }, cachePaths: [path] };
  },
});
