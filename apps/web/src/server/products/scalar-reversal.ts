import type { DomainActor } from '@/server/actor';
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { liveProductWhere } from "@/server/access/live-entities";
import { lockProductRow } from "./quantity-core";

export const PRODUCT_TITLE_REVERSAL = "product.title";

export function titleReversalCommand(before: { title: string }, after: { title: string; titleRevision: number }) {
  if (before.title === after.title) return undefined;
  return { kind: PRODUCT_TITLE_REVERSAL, version: 1, data: { previous: before.title, expected: after.title, revision: after.titleRevision } };
}

type ScalarState<T> = { value: T; revision: number };

/** Версия должна обновляться на всех путях изменения поля под блокировкой изделия. */
export function productScalarReversal<T extends string | null>(options: {
  kind: string;
  value: z.ZodType<T>;
  read(tx: Prisma.TransactionClient, productId: string): Promise<ScalarState<T> | null>;
  update(ctx: { tx: Prisma.TransactionClient; actor: DomainActor; entityId: string },
    previous: T, value: T): Promise<ScalarState<T>>;
}) {
  const schema = z.object({ previous: options.value, expected: options.value, revision: z.number().int().positive() });
  type Payload = { previous: T; expected: T; revision: number };
  async function conflict(tx: Prisma.TransactionClient, id: string, data: Payload) {
    if (!await tx.product.findFirst({ where: { id, ...liveProductWhere }, select: { id: true } }))
      return "Изделие удалено или недоступно";
    const current = await options.read(tx, id);
    return current?.revision === data.revision && current.value === data.expected
      ? null : "После этого действия поле изменилось";
  }

  return defineJournalReversal<Payload>({
    kind: options.kind, version: 1, schema,
    preview: (ctx, data) => conflict(ctx.tx, ctx.entityId, data),
    async apply(ctx, data) {
      await lockProductRow(ctx.tx, ctx.entityId);
      const reason = await conflict(ctx.tx, ctx.entityId, data);
      if (reason) throw new JournalReversalRefusal(reason);
      const result = await options.update(ctx, data.expected, data.previous);
      return {
        inverse: { previous: data.expected, expected: result.value, revision: result.revision },
        oldValue: data.expected, newValue: result.value,
      };
    },
  });
}
