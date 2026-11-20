import { prisma } from "@/lib/prisma";
import type { DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { isLegalView, viewDefaults, viewPreferenceReversal } from "./view-preference-reversal";

// UI-предпочтения per user (§7): вид разделов (канбан/таблица) и пр.
export async function getUserPreference(
  userId: string,
  key: string,
): Promise<string | null> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
  });
  return row?.value ?? null;
}

export async function setUserPreference(actor: DomainActor, key: string, value: string): Promise<boolean> {
  if (!isLegalView(key, value) || (key !== "tasks.view" && key !== "my.view")) return false;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
    const where = { userId_key: { userId: actor.id, key } };
    const row = await tx.userPreference.findUnique({ where });
    const saved = row?.value && isLegalView(key, row.value) ? row.value : viewDefaults[key];
    const before = saved as "kanban" | "table" | "list";
    const after = value as typeof before;
    if (before === after) return;
    const result = await tx.userPreference.upsert({ where, create: { userId: actor.id, key, value },
      update: { value, revision: { increment: 1 } } });
    await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "userPreference", entityId: `${actor.id}:${key}`, action: "update", oldValue: before, newValue: after,
      reversal: viewPreferenceReversal.command({ userId: actor.id, key, before, after, revision: result.revision }),
    }, { before, after, entity: { label: key === "tasks.view" ? "Вид раздела задач" : "Вид своих задач" } });
  });
  return true;
}
