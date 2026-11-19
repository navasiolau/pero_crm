import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import type { DomainActor } from "@/server/actor";

const schema = z.object({
  ownerId: z.string().min(1), expectedReadAt: z.iso.datetime().nullable(), readAt: z.iso.datetime().nullable(),
  rows: z.array(z.object({ id: z.string().min(1), revision: z.int().nonnegative() }).strict()).min(1),
}).strict();
type Command = z.infer<typeof schema>;

function matchingNotifications(command: Command, rows: Command["rows"]): Prisma.NotificationWhereInput {
  return {
    userId: command.ownerId, type: { not: "plan.reminder" },
    readAt: command.expectedReadAt ? new Date(command.expectedReadAt) : null,
    OR: rows.map(({ id, revision }) => ({ id, readRevision: revision })),
  };
}

const changed = "Отметки уведомлений изменились после этого действия";

async function applyReadState(tx: Prisma.TransactionClient, command: Command, write: boolean) {
  // Ограничиваем число параметров запроса при массовом чтении.
  for (let i = 0; i < command.rows.length; i += 500) {
    const rows = command.rows.slice(i, i + 500);
    const where = matchingNotifications(command, rows);
    const count = write
      ? (await tx.notification.updateMany({ where, data: {
        readAt: command.readAt ? new Date(command.readAt) : null, readRevision: { increment: 1 },
      } })).count
      : await tx.notification.count({ where });
    if (count !== rows.length) return false;
  }
  return true;
}

export const notificationReadReversal = defineJournalReversal({
  kind: "notification.read", version: 1, schema,
  async preview({ tx, entityId }, command) {
    return entityId === command.ownerId && await applyReadState(tx, command, false) ? null : changed;
  },
  async apply({ tx, entityId }, command) {
    if (entityId !== command.ownerId || !await applyReadState(tx, command, true)) throw new JournalReversalRefusal(changed);
    return {
      inverse: { ...command, expectedReadAt: command.readAt, readAt: command.expectedReadAt,
        rows: command.rows.map(row => ({ ...row, revision: row.revision + 1 })) },
      oldValue: { read: !!command.expectedReadAt, count: command.rows.length },
      newValue: { read: !!command.readAt, count: command.rows.length }, cachePaths: ["/notifications"],
    };
  },
});

export async function markNotificationsReadInTransaction(
  tx: Prisma.TransactionClient, actor: DomainActor, scope: Prisma.NotificationWhereInput,
) {
  const now = new Date();
  const base: Prisma.NotificationWhereInput = { AND: [scope, { userId: actor.id, readAt: null }] };
  const saved = await tx.notification.updateManyAndReturn({
    where: { AND: [base, { type: { not: "plan.reminder" } }] },
    data: { readAt: now, readRevision: { increment: 1 } }, select: { id: true, readRevision: true },
  });
  // Приватные напоминания личного плана обрабатываются в прежней области видимости.
  await tx.notification.updateMany({ where: { AND: [base, { type: "plan.reminder" }] }, data: { readAt: now } });
  if (!saved.length) return;
  await writeChangeLogInTransaction(tx, {
    actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "notification", entityId: actor.id, action: "markRead",
    oldValue: { read: false, count: saved.length }, newValue: { read: true, count: saved.length },
    reversal: notificationReadReversal.command({ ownerId: actor.id, expectedReadAt: now.toISOString(), readAt: null,
      rows: saved.map(row => ({ id: row.id, revision: row.readRevision })).sort((a, b) => a.id.localeCompare(b.id)) }),
  }, { entity: { label: "Прочтение уведомлений", href: "/notifications" }, contexts: [] });
}
