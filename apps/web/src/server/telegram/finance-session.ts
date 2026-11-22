import { auth } from "@/auth";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import { findActiveTelegramLink } from "./access";
import {
  readFinanceGrant, signFinanceGrant, TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_TTL_SECONDS,
} from "./finance-security";

export type TelegramFinanceSession = Session & { telegramFinance: true };
type FinanceSessionResult = { kind: "authenticated"; session: TelegramFinanceSession } | { kind: "forbidden" };

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

export async function startTelegramFinanceSession(chatId: string, secret: string, authenticatedAt: number) {
  const link = await findActiveTelegramLink({ chatId });
  if (!link) return { kind: "unlinked" } as const;
  if (!hasAnyRole(link.user.roles, FINANCE_ROLES)) return { kind: "forbidden" } as const;
  if (authenticatedAt < Math.max(link.linkedAt.getTime(), link.user.updatedAt.getTime())) return { kind: "stale" } as const;
  const proof = signFinanceGrant({
    chatId, linkId: link.id, linkedAt: link.linkedAt.toISOString(), generation: link.generation, userId: link.user.id,
    version: link.user.sessionVersion, expires: Math.floor(Date.now() / 1000) + TELEGRAM_FINANCE_TTL_SECONDS,
  }, secret);
  return { kind: "signed", proof } as const;
}

export async function resolveTelegramFinanceSession(raw?: string): Promise<FinanceSessionResult | null> {
  const config = telegramFinanceConfig();
  if (!config || !raw) return null;
  const grant = readFinanceGrant(raw, config.secret);
  if (!grant) return null;
  const link = await findActiveTelegramLink({ chatId: grant.chatId });
  if (!link || link.id !== grant.linkId || link.generation !== grant.generation ||
      link.linkedAt.toISOString() !== grant.linkedAt || link.user.id !== grant.userId) return null;
  if (!hasAnyRole(link.user.roles, FINANCE_ROLES)) return { kind: "forbidden" };
  if (link.user.sessionVersion !== grant.version) return null;
  const { id, name, email, roles, sessionVersion } = link.user;
  return {
    kind: "authenticated",
    session: {
      telegramFinance: true,
      expires: new Date(grant.expires * 1000).toISOString(),
      user: { id, name, email, roles, sessionVersion },
    },
  };
}

/** Только адаптеры явно перечисленных рабочих операций используют Telegram-сессию. */
export async function scopedFinanceAuth(telegramOnly = false) {
  if (telegramFinanceConfig()) {
    const jar = await cookies();
    const raw = jar.get(TELEGRAM_FINANCE_COOKIE)?.value;
    if (raw) {
      const result = await resolveTelegramFinanceSession(raw);
      return result?.kind === "authenticated" ? result.session : null;
    }
  }
  return telegramOnly ? null : auth();
}

export function financeSessionSource(session: Session): "telegram" | "web" {
  return "telegramFinance" in session ? "telegram" : "web";
}
