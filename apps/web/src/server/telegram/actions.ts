"use server";

import { financeSessionSource } from "@/server/telegram/finance-session";

import { randomBytes } from "crypto";

import { auth } from "@/auth";
import { scopedFinanceAuth } from "./finance-session";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/require-role";
import { requestTelegramLinkInTransaction, unlinkTelegramInTransaction } from "./mutation-core";

// Привязка Telegram-аккаунта (сервис telegram-bot): одноразовый код из
// профиля → пользователь открывает t.me/<bot>?start=<код> → бот подтверждает
// через POST /api/v1/bot/link. Привязка доступна любой роли; использование
// бота ограничено ADMIN/DIRECTOR/MANAGER (решение владельца).
// Отвязка через бота НЕ предусмотрена (решение владельца): пользователь —
// из профиля, администратор — отсюда (управление пользователями).

const CODE_TTL_MS = 15 * 60 * 1000;

function generateCode(): string {
  return randomBytes(18).toString("base64url");
}

async function getSessionUser(allowFinance = false) {
  const session = await (allowFinance ? scopedFinanceAuth() : auth());
  if (!session?.user) throw new Error("Не авторизован");
  return { user: session.user, source: financeSessionSource(session) };
}

export async function getTelegramLinkStatus(): Promise<{
  deployed: boolean; // бот зарегистрирован (известен @username)
  botUsername: string | null;
  linked: boolean;
  username: string | null;
}> {
  const { user } = await getSessionUser(true);
  const setting = await prisma.orgSetting.findUnique({
    where: { key: "telegram.botUsername" },
  });
  const link = await prisma.telegramLink.findUnique({
    where: { userId: user.id },
  });
  return {
    deployed: !!setting?.value,
    botUsername: setting?.value ?? null,
    linked: !!link?.chatId && !link.revokedAt,
    username: link?.username ?? null,
  };
}

export async function requestTelegramLink(): Promise<{
  ok: boolean;
  url?: string;
  code?: string;
  error?: string;
}> {
  const { user, source } = await getSessionUser();
  const code = generateCode();
  const result = await prisma.$transaction(tx => requestTelegramLinkInTransaction(tx,
    { id: user.id, name: user.name ?? "", roles: user.roles, source }, code, new Date(Date.now() + CODE_TTL_MS)));
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    url: `https://t.me/${result.botUsername}?start=${code}`,
    code,
  };
}

export async function unlinkTelegram(): Promise<{ ok: boolean }> {
  const { user, source } = await getSessionUser(true);
  await prisma.$transaction(tx => unlinkTelegramInTransaction(tx, { id: user.id, name: user.name ?? "", roles: user.roles, source }, user.id));
  return { ok: true };
}

// ─── Отвязка администратором (управление пользователями) ────────────────────

export async function getTelegramLinkStatusFor(
  userId: string,
): Promise<{ linked: boolean; username: string | null }> {
  await requireAdmin();
  const link = await prisma.telegramLink.findUnique({ where: { userId } });
  return { linked: !!link?.chatId && !link.revokedAt, username: link?.username ?? null };
}

export async function unlinkTelegramFor(userId: string): Promise<{ ok: boolean }> {
  const session = await requireAdmin();
  await prisma.$transaction(tx => unlinkTelegramInTransaction(tx,
    { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, userId));
  return { ok: true };
}
