import { createHash } from "node:crypto";
import type { Prisma, TelegramLink } from "@prisma/client";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";

const userSelection = { id: true, name: true, roles: true, active: true, sessionVersion: true } as const;
const challengeDigest = (code: string) => createHash("sha256").update("telegram-link:").update(code).digest("hex");
const snapshot = (row: TelegramLink | null) => row ? {
  userId: row.userId, linkId: row.id, username: row.username, generation: row.generation,
  linkedAt: row.linkedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null,
  linkRequested: !!row.linkCode, linkCodeExpiresAt: row.linkCodeExpiresAt?.toISOString() ?? null,
} : null;
const rejected = (error: string, status: 400 | 403 = 400) => ({ ok: false as const, error, status });

async function recordLink(tx: Prisma.TransactionClient, actor: DomainActor, userId: string, userName: string, action: string, before: TelegramLink | null, after: TelegramLink | null) {
  const oldValue = snapshot(before), newValue = snapshot(after);
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "telegramLink", entityId: userId, action, oldValue, newValue }, {
    before: oldValue, after: newValue, entity: { label: `Telegram — ${userName || "пользователь"}` },
    links: [{ type: "user", id: userId, label: userName || "Имя не сохранено", href: "/settings/users" }],
  });
}

export async function requestTelegramLinkInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, code: string, expiresAt: Date) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
  const setting = await tx.orgSetting.findUnique({ where: { key: "telegram.botUsername" } });
  if (!setting?.value) return rejected("Бот не подключён — обратитесь к администратору");
  const before = await tx.telegramLink.findUnique({ where: { userId: actor.id } });
  if (before?.linkedAt && !before.revokedAt) return rejected("Сначала отвяжите действующий Telegram");
  const digest = challengeDigest(code);
  const link = await tx.telegramLink.upsert({ where: { userId: actor.id }, create: { userId: actor.id }, update: {} });
  const reserved = await tx.telegramLinkChallenge.createMany({ data: { digest, linkId: link.id }, skipDuplicates: true });
  if (!reserved.count) return rejected("Запросите новый код Telegram");
  const after = await tx.telegramLink.update({ where: { id: link.id }, data: { linkCode: digest, linkCodeExpiresAt: expiresAt } });
  await recordLink(tx, actor, actor.id, actor.name, "link.request", before, after);
  return { ok: true as const, botUsername: setting.value };
}

export async function confirmTelegramLinkInTransaction(tx: Prisma.TransactionClient, input: { code: string; chatId: string; username?: string }) {
  if (!/^[1-9]\d{0,15}$/.test(input.chatId)) return rejected("Откройте личный чат с ботом");
  const digest = challengeDigest(input.code);
  const reference = await tx.telegramLink.findUnique({ where: { linkCode: digest }, select: { userId: true } });
  if (!reference) return rejected("Код не найден или истёк — запросите новый в профиле CRM");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-chat:${input.chatId}`}, 0))`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${reference.userId} FOR UPDATE`;
  const link = await tx.telegramLink.findUnique({ where: { linkCode: digest }, include: { user: { select: userSelection } } });
  if (!link || link.userId !== reference.userId || (link.linkedAt && !link.revokedAt) ||
      !link.linkCodeExpiresAt || link.linkCodeExpiresAt.getTime() <= Date.now()) {
    return rejected("Код не найден или истёк — запросите новый в профиле CRM");
  }
  if (!link.user.active) return rejected("Пользователь неактивен", 403);
  if (await tx.telegramLink.findFirst({ where: { chatId: input.chatId, NOT: { userId: link.userId } }, select: { id: true } }))
    return rejected("Этот Telegram уже привязан к другой учётной записи");
  const updated = await tx.telegramLink.update({ where: { id: link.id }, data: {
    chatId: input.chatId, username: input.username ?? null, generation: { increment: 1 }, revokedAt: null,
    linkedAt: new Date(Math.max(Date.now(), (link.revokedAt?.getTime() ?? 0) + 1)), linkCode: null, linkCodeExpiresAt: null,
  } });
  await recordLink(tx, { id: link.user.id, name: link.user.name, roles: link.user.roles, source: "telegram" }, link.userId, link.user.name, "link", link, updated);
  return { ok: true as const, user: link.user, linkedAt: updated.linkedAt, binding: `${updated.id}:${updated.generation}:${link.user.sessionVersion}` };
}

export async function unlinkTelegramInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, userId: string) {
  if (actor.id !== userId) requireActorRoles(actor, ADMIN_ROLES);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const before = await tx.telegramLink.findUnique({ where: { userId }, include: { user: { select: userSelection } } });
  if (!before || (!before.chatId && !before.linkCode)) return { ok: true as const, deleted: 0 };
  const after = await tx.telegramLink.update({ where: { id: before.id }, data: {
    generation: { increment: 1 }, revokedAt: new Date(Math.max(Date.now(), (before.revokedAt?.getTime() ?? 0) + 1, (before.linkedAt?.getTime() ?? 0) + 1)), chatId: null, username: null,
    linkedAt: null, linkCode: null, linkCodeExpiresAt: null,
  } });
  await recordLink(tx, actor, userId, before.user.name, "unlink", before, after);
  return { ok: true as const, deleted: 1 };

}

export async function unlinkTelegramChatInTransaction(tx: Prisma.TransactionClient, chatId: string, expectedBinding?: string) {
  const before = await tx.telegramLink.findUnique({ where: { chatId }, include: { user: { select: userSelection } } });
  if (!before || (expectedBinding !== undefined && expectedBinding !== `${before.id}:${before.generation}:${before.user.sessionVersion}`)) return { ok: true as const, deleted: 0 };
  // Повторная проверка привязки после lock не позволяет удалить уже перепривязанный чат.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${before.userId} FOR UPDATE`;
  const current = await tx.telegramLink.findUnique({ where: { userId: before.userId }, include: { user: { select: userSelection } } });
  if (!current || current.chatId !== chatId || current.revokedAt || current.generation !== before.generation || current.user.sessionVersion !== before.user.sessionVersion) return { ok: true as const, deleted: 0 };
  return unlinkTelegramInTransaction(tx, { id: current.userId, name: current.user.name, roles: current.user.roles, source: "telegram" }, current.userId);
}

export async function registerTelegramBotInTransaction(tx: Prisma.TransactionClient, username: string) {
  // Сериализует также первое создание ключа: row lock ещё несуществующей строки недостаточен.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(228, 1)`;
  const before = await tx.orgSetting.findUnique({ where: { key: "telegram.botUsername" } });
  if (before?.value === username) return { ok: true as const, noOp: true };
  await tx.orgSetting.upsert({ where: { key: "telegram.botUsername" }, create: { key: "telegram.botUsername", value: username }, update: { value: username } });
  await writeChangeLogInTransaction(tx, { actorType: "system", actorId: "system:telegram", actorName: "Система", source: "telegram",
    entity: "orgSetting", entityId: "telegram.botUsername", action: "update", field: "botUsername", oldValue: before?.value ?? null, newValue: username }, {
    before: before?.value ?? null, after: username, entity: { label: "Регистрация Telegram-бота" }, reason: "Регистрация бота при запуске",
  });
  return { ok: true as const, noOp: false };
}
