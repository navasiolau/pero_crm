import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import { authenticateCrmCredentials } from "@/server/auth/credentials";
import { bindTelegramFinanceInTransaction } from "./mutation-core";

export const TELEGRAM_BINDING_COOKIE = "__Host-pero-telegram-binding";
const isPendingId = (value?: string) => !!value && /^[\da-f-]{36}$/.test(value);

export async function openTelegramFinanceBinding(identity: { chatId: string; authenticatedAt: number }, launchHash: string, cookie?: string) {
  if (await prisma.telegramLink.findUnique({ where: { chatId: identity.chatId }, select: { id: true } })) return null;
  const expiresAt = new Date(identity.authenticatedAt + 120_000);
  if (expiresAt.getTime() <= Date.now()) return null;
  const id = randomUUID();
  const { count } = await prisma.telegramFinanceBinding.createMany({
    data: { id, launchHash, chatId: identity.chatId, expiresAt }, skipDuplicates: true,
  });
  if (count) return { id, expiresAt, candidate: undefined };
  if (!isPendingId(cookie)) return null;
  const pending = await prisma.telegramFinanceBinding.findUnique({ where: { launchHash } });
  if (!pending || pending.id !== cookie || pending.consumedAt || pending.expiresAt <= new Date()) return null;
  const user = pending.userId ? await prisma.user.findUnique({ where: { id: pending.userId }, select: { name: true, roles: true, active: true, sessionVersion: true } }) : null;
  if (pending.userId && (!user?.active || user.sessionVersion !== pending.sessionVersion || !hasAnyRole(user.roles, FINANCE_ROLES))) return null;
  return { id: pending.id, expiresAt: pending.expiresAt, candidate: user?.name };
}

export async function verifyTelegramFinanceBindingAccount(id: string | undefined, credentials: unknown) {
  if (!id || !isPendingId(id)) return { ok: false as const, expired: true };
  const reservation = await prisma.$transaction(async tx => {
    const pending = await tx.telegramFinanceBinding.findUnique({ where: { id } });
    if (!pending || pending.consumedAt || pending.expiresAt <= new Date()) return null;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"telegram-binding-rate:" + pending.chatId}, 0))`;
    const attempts = await tx.telegramFinanceBinding.aggregate({ where: { chatId: pending.chatId, createdAt: { gt: new Date(Date.now() - 900_000) } },
      _sum: { attempts: true } });
    if ((attempts._sum.attempts ?? 0) >= 10) return "limited";
    const reserved = await tx.telegramFinanceBinding.updateMany({ where: { id, userId: null, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } } });
    return reserved.count === 1 ? "reserved" : null;
  });
  if (reservation === "limited") return { ok: false as const, limited: true };
  if (!reservation) return { ok: false as const, expired: true };

  const user = await authenticateCrmCredentials(credentials);
  if (!user || !hasAnyRole(user.roles, FINANCE_ROLES)) return { ok: false as const };
  const link = await prisma.telegramLink.findUnique({ where: { userId: user.id } });
  if (link?.chatId) return { ok: false as const, occupied: true };
  const verified = await prisma.telegramFinanceBinding.updateMany({ where: { id, userId: null, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { userId: user.id, sessionVersion: user.sessionVersion, linkId: link?.id ?? null, linkGeneration: link?.generation ?? null } });
  return verified.count === 1 ? { ok: true as const, name: user.name } : { ok: false as const, expired: true };
}

export async function finishTelegramFinanceBinding(id?: string) {
  if (!id || !isPendingId(id)) return null;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "TelegramFinanceBinding" WHERE id = ${id} FOR UPDATE`;
    const pending = await tx.telegramFinanceBinding.findUnique({ where: { id } });
    if (!pending?.userId || pending.sessionVersion === null || pending.consumedAt || pending.expiresAt <= new Date()) return null;
    await tx.telegramFinanceBinding.update({ where: { id }, data: { consumedAt: new Date() } });
    return bindTelegramFinanceInTransaction(tx, { ...pending, userId: pending.userId, sessionVersion: pending.sessionVersion });
  });
}
