import { notificationPreferenceReversal } from "./preference-reversal";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { notificationPreferenceEnabled, notificationPreferenceTypes } from "./preferences";

export async function setNotificationPreferenceInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, type: string, enabled: boolean, label: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
  const rows = await tx.notificationPreference.findMany({ where: { userId: actor.id, type: { in: notificationPreferenceTypes(type) } } });
  const current = rows.find(row => row.type === type);
  if (current?.enabled === enabled) return { ok: true as const, noOp: true };
  const before = { type, enabled: notificationPreferenceEnabled(type, new Map(rows.map(row => [row.type, row.enabled]))), configured: current !== undefined };
  const saved = await tx.notificationPreference.upsert({ where: { userId_type: { userId: actor.id, type } }, create: { userId: actor.id, type, enabled }, update: { enabled, revision: { increment: 1 } } });
  if (type !== "plan.reminder") {
    const after = { type, enabled, configured: true };
    await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "notificationPreference", entityId: `${actor.id}:${type}`, action: "update", oldValue: before, newValue: after,
      reversal: notificationPreferenceReversal.command({ userId: actor.id, type, before: before.enabled, after: enabled, revision: saved.revision }) }, {
      before, after, entity: { label: `Уведомления: ${label}`, href: "/notifications" },
      links: [{ type: "user", id: actor.id, label: actor.name, href: "/settings/users" }],
    });
  }
  return { ok: true as const, noOp: false };
}
