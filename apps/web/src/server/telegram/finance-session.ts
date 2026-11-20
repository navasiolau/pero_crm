import { auth } from "@/auth";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import {
  readFinanceGrant, signFinanceGrant, TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_TTL_SECONDS,
} from "./finance-security";

export type TelegramFinanceSession = Session & { telegramFinance: true };

export function telegramFinanceConfig() {
  const origin = process.env.PERO_TELEGRAM_FINANCE_ORIGIN;
  const telegramToken = process.env.PERO_TELEGRAM_FINANCE_BOT_TOKEN;
  const secret = process.env.PERO_TELEGRAM_FINANCE_SESSION_SECRET;
  if (!origin || !telegramToken || !secret || secret.length < 32 || secret === telegramToken) return null;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.origin === origin ? { origin, telegramToken, secret } : null;
  } catch {
    return null;
  }
}

async function currentFinanceLink(chatId: string) {
  const link = await prisma.telegramLink.findUnique({
    where: { chatId },
    select: { id: true, linkedAt: true, revokedAt: true, generation: true, user: {
      select: { id: true, active: true, name: true, email: true, roles: true, sessionVersion: true, updatedAt: true },
    } },
  });
  return link?.linkedAt && !link.revokedAt && link.user.active && hasAnyRole(link.user.roles, FINANCE_ROLES)
    ? { id: link.id, linkedAt: link.linkedAt.toISOString(), generation: link.generation, user: link.user } : null;
}

export async function startTelegramFinanceSession(chatId: string, secret: string, authenticatedAt: number) {
  const link = await currentFinanceLink(chatId);
  if (!link || authenticatedAt < Math.max(Date.parse(link.linkedAt), link.user.updatedAt.getTime())) return null;
  return signFinanceGrant({
    chatId, linkId: link.id, linkedAt: link.linkedAt, generation: link.generation, userId: link.user.id,
    version: link.user.sessionVersion, expires: Math.floor(Date.now() / 1000) + TELEGRAM_FINANCE_TTL_SECONDS,
  }, secret);
}

export async function resolveTelegramFinanceSession(raw?: string): Promise<TelegramFinanceSession | null> {
  const config = telegramFinanceConfig();
  if (!config || !raw) return null;
  const grant = readFinanceGrant(raw, config.secret);
  if (!grant) return null;
  const link = await currentFinanceLink(grant.chatId);
  if (!link || link.id !== grant.linkId || link.generation !== grant.generation || link.linkedAt !== grant.linkedAt || link.user.id !== grant.userId ||
      link.user.sessionVersion !== grant.version) return null;
  const { id, name, email, roles, sessionVersion } = link.user;
  return {
    telegramFinance: true,
    expires: new Date(grant.expires * 1000).toISOString(),
    user: { id, name, email, roles, sessionVersion },
  };
}

/** Только адаптеры явно перечисленных рабочих операций используют Telegram-сессию. */
export async function scopedFinanceAuth() {
  if (telegramFinanceConfig()) {
    const jar = await cookies();
    const raw = jar.get(TELEGRAM_FINANCE_COOKIE)?.value;
    if (raw) return resolveTelegramFinanceSession(raw);
  }
  return auth();
}

export function financeSessionSource(session: Session): "telegram" | "web" {
  return "telegramFinance" in session ? "telegram" : "web";
}
