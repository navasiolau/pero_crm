import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { DomainActor } from "@/server/actor";
import { defineJournalReversal, JournalReversalRefusal } from "./reversal-contract";

type FieldValue = Prisma.InputJsonValue | null;
type FieldState<T> = { value: T; revision: number };
type FieldContext = { tx: Prisma.TransactionClient; actor: DomainActor; entityId: string; reversalId?: string };
type FieldEffect<T> = FieldState<T> & { cachePaths?: string[]; eventIds?: string[] };
const revisionSchema = z.number().int().nonnegative();
const markerSchema = z.object({ kind: z.string(), data: z.object({ revision: revisionSchema, restores: revisionSchema.optional() }) });

export function fieldCommand<T extends FieldValue>(kind: string, before: FieldState<T>, after: FieldState<T>, version = 2) {
  if (!after.revision || after.revision <= before.revision || isDeepStrictEqual(before.value, after.value)) return undefined;
  return { kind, version, data: { previous: before.value, expected: after.value, revision: after.revision } };
}

export function defineFieldReversal<T extends FieldValue>(options: {
  kind: string;
  entity: string;
  field: string;
  version?: number;
  value: z.ZodType<T>;
  read(tx: Prisma.TransactionClient, id: string): Promise<FieldState<T> | null>;
  lock(tx: Prisma.TransactionClient, id: string): Promise<unknown>;
  update(ctx: FieldContext, previous: T, value: T): Promise<FieldEffect<T>>;
}) {
  type Payload = { previous: T; expected: T; revision: number; restores?: number };
  const schema = z.object({ previous: options.value, expected: options.value, revision: revisionSchema.positive(), restores: revisionSchema.optional() });

  async function stateAt(tx: Prisma.TransactionClient, entityId: string, revision: number) {
    let cursor = revision;
    let entryId: string | undefined;
    while (cursor > 0) {
      const rows = await tx.changeLog.findMany({
        where: { entity: options.entity, entityId,
          AND: [{ reversal: { path: ["kind"], equals: options.kind } }, { reversal: { path: ["data", "revision"], equals: cursor } }] },
        select: { id: true, reversal: true, reversesId: true }, take: 2,
      });
      if (rows.length !== 1) break;
      const [row] = rows;
      entryId ??= row.id;
      if (!row.reversesId) break;
      const command = markerSchema.safeParse(row.reversal);
      if (!command.success) break;
      const restored = command.data.data.restores;
      if (restored !== undefined && restored < cursor) return { revision: restored, entryId };

      // У прежних отмен названия применялась проверка точной физической версии.
      const target = await tx.changeLog.findUnique({ where: { id: row.reversesId },
        select: { entity: true, entityId: true, field: true, reversal: true } });
      const source = markerSchema.safeParse(target?.reversal);
      if (!source.success || target?.entity !== options.entity || target.entityId !== entityId ||
          source.data.kind !== options.kind ||
          source.data.data.revision !== cursor - 1) break;
      cursor -= 2;
    }
    return { revision: cursor, entryId };
  }

  async function check(ctx: FieldContext, data: Payload) {
    const current = await options.read(ctx.tx, ctx.entityId);
    if (!current) throw new JournalReversalRefusal("Карточка недоступна");
    if (current.revision === data.revision && isDeepStrictEqual(current.value, data.expected)) return;
    const state = await stateAt(ctx.tx, ctx.entityId, current.revision);
    const target = data.restores ?? (await stateAt(ctx.tx, ctx.entityId, data.revision)).revision;
    if (state.revision === target && isDeepStrictEqual(current.value, data.expected)) return;
    throw new JournalReversalRefusal("После этого действия поле изменилось",
      state.entryId ? `/changelog?q=${encodeURIComponent(state.entryId)}` : undefined);
  }

  return defineJournalReversal<Payload>({
    kind: options.kind, version: options.version ?? 2, schema,
    async preview(ctx, data) { await check(ctx, data); return null; },
    async apply(ctx, data) {
      await options.lock(ctx.tx, ctx.entityId);
      await check(ctx, data);
      const restores = (await stateAt(ctx.tx, ctx.entityId, data.revision - 1)).revision;
      const result = await options.update(ctx, data.expected, data.previous);
      if (!isDeepStrictEqual(result.value, data.previous))
        throw new JournalReversalRefusal("Исходное значение поля уже нельзя восстановить");
      return {
        inverse: { previous: data.expected, expected: result.value, revision: result.revision, restores },
        oldValue: data.expected, newValue: result.value, cachePaths: result.cachePaths, eventIds: result.eventIds,
      };
    },
  });
}

export function cardFieldRevision(revisions: Prisma.JsonValue | undefined, field: string): number {
  if (revisions === null || typeof revisions !== "object" || Array.isArray(revisions)) return 0;
  const value = revisions[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
