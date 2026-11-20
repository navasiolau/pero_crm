import type { Prisma } from "@prisma/client";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { z } from "zod";
import { normalizeJournalScope } from "./query-contract";
import { journalInScope } from "./reader-core";
import { parseJournalPresentation } from "./presentation";
import { JournalReversalRefusal } from "./reversal-contract";
import { journalReversals } from "./reversal-registry";
import { writeChangeLogInTransaction } from "./writer";

const commandSchema = z.object({ kind: z.string(), version: z.number().int(), data: z.unknown() });
const entrySchema = z.object({ entryId: z.string().min(1).max(200), scope: z.unknown() });
const requestSchema = entrySchema.extend({ requestId: z.string().uuid() });

async function withEntityHistory<T>(entityId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof JournalReversalRefusal && !error.href)
      throw new JournalReversalRefusal(error.message, "/changelog?q=" + encodeURIComponent(entityId));
    throw error;
  }
}

async function loadReversal(tx: Prisma.TransactionClient, actorId: string, input: z.infer<typeof entrySchema>) {
  const user = await tx.user.findUnique({
    where: { id: actorId },
    select: { id: true, name: true, active: true, roles: true },
  });
  if (!user?.active || !hasAnyRole(user.roles, ADMIN_ROLES))
    throw new JournalReversalRefusal("Недостаточно прав");
  const scope = normalizeJournalScope(input.scope);
  const select = { operationRootId: true, id: true, entity: true, entityId: true, field: true, reversal: true, presentation: true } as const;
  const selected = await tx.changeLog.findUnique({ where: { id: input.entryId }, select });
  const detail = parseJournalPresentation(selected?.presentation);
  if (!selected || !detail || !journalInScope(detail, scope))
    throw new JournalReversalRefusal("Запись журнала не найдена");
  const root = selected.operationRootId
    ? await tx.changeLog.findUniqueOrThrow({ where: { id: selected.operationRootId }, select })
    : selected;
  const presentation = root.id === selected.id ? detail : parseJournalPresentation(root.presentation);
  if (root.operationRootId || !presentation || presentation.kind !== "event")
    throw new JournalReversalRefusal("Для этой записи откат недоступен");
  const command = commandSchema.safeParse(root.reversal);
  const handler = command.success
    ? journalReversals.find(item => item.kind === command.data.kind && item.version === command.data.version)?.read(command.data.data)
    : null;
  if (!handler) throw new JournalReversalRefusal("Для этой записи откат недоступен");
  return { root, handler, presentation,
    ctx: { tx, actor: { id: user.id, name: user.name, roles: user.roles, source: "web" as const }, entryId: root.id, entityId: root.entityId } };
}

export async function previewJournalReversalInTransaction(tx: Prisma.TransactionClient, actorId: string, input: unknown) {
  const { root, handler, presentation, ctx } = await loadReversal(tx, actorId, entrySchema.parse(input));
  if (await tx.changeLog.findUnique({ where: { reversesId: root.id }, select: { id: true } }))
    throw new JournalReversalRefusal("Действие уже отменено");
  await withEntityHistory(root.entityId, async () => {
    const reason = await handler.preview(ctx);
    if (reason) throw new JournalReversalRefusal(reason);
  });
  return { entryId: root.id, entityLabel: presentation.entity.label, actionLabel: presentation.action.label,
    ...(handler.confirmation ? { confirmation: handler.confirmation } : {}) };
}

export async function reverseJournalActionInTransaction(tx: Prisma.TransactionClient, actorId: string, input: unknown) {
  const request = requestSchema.parse(input);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR SHARE`;
  const { root, handler, presentation, ctx } = await loadReversal(tx, actorId, request);
  // Журнал доступен для добавления и чтения. Сериализуем откаты по исходному ID без права менять строку истории.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18469, hashtext(${root.id}))`;
  const reversalId = `journal-reversal:${request.requestId.toLowerCase()}`;
  const earlier = await tx.changeLog.findUnique({ where: { id: reversalId }, select: { actorId: true, reversesId: true } });
  if (earlier) {
    if (earlier.actorId !== actorId || earlier.reversesId !== root.id)
      throw new JournalReversalRefusal("Идентификатор запроса уже использован");
    return { reversalId, contexts: presentation.contexts, cachePaths: undefined, eventIds: undefined };
  }
  if (await tx.changeLog.findUnique({ where: { reversesId: root.id }, select: { id: true } }))
    throw new JournalReversalRefusal("Действие уже отменено");
  const effect = await withEntityHistory(root.entityId, () => handler.apply({ ...ctx, reversalId }));
  await writeChangeLogInTransaction(tx, {
    id: reversalId, reversesId: root.id, reversal: effect.reversal,
    actorType: "user", actorId, actorName: ctx.actor.name, source: ctx.actor.source,
    entity: root.entity, entityId: root.entityId, field: root.field, action: "journal.reverse",
    oldValue: effect.oldValue, newValue: effect.newValue,
  }, { entity: presentation.entity, contexts: presentation.contexts, ...effect.hints, kind: "event" });
  await effect.afterWrite?.(reversalId);
  return { reversalId, contexts: presentation.contexts, cachePaths: effect.cachePaths, eventIds: effect.eventIds };
}
