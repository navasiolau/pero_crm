"use server";

import { randomBytes } from "crypto";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/require-role";
import { requestTelegramLinkInTransaction, unlinkTelegramInTransaction } from "./mutation-core";

// Привязка Telegram-аккаунта (сервис telegram-bot): одноразовый код из
// профиля → пользователь открывает t.me/<bot>?start=<код> → бот подтверждает
// через POST /api/v1/bot/link. Привязка доступна любой роли; использование
// бота ограничено ADMIN/DIRECTOR/MANAGER (решение владельца).
// Отвязка через бота НЕ предусмотрена (решение владельца): пользователь —
// из профиля, администратор — отсюда (управление пользователями).

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без похожих 0/O/1/I
const CODE_LENGTH = 8;
const CODE_TTL_MS = 15 * 60 * 1000;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

async function getSessionUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session.user;
}

export async function getTelegramLinkStatus(): Promise<{
  deployed: boolean; // бот зарегистрирован (известен @username)
  botUsername: string | null;
  linked: boolean;
  username: string | null;
}> {
  const user = await getSessionUser();
  const setting = await prisma.orgSetting.findUnique({
    where: { key: "telegram.botUsername" },
  });
  const link = await prisma.telegramLink.findUnique({
    where: { userId: user.id },
  });
  return {
    deployed: !!setting?.value,
    botUsername: setting?.value ?? null,
    linked: !!link?.chatId,
    username: link?.username ?? null,
  };
}

export async function requestTelegramLink(): Promise<{
  ok: boolean;
  url?: string;
  code?: string;
  error?: string;
}> {
  const user = await getSessionUser();
  const code = generateCode();
  const result = await prisma.$transaction(tx => requestTelegramLinkInTransaction(tx,
    { id: user.id, name: user.name ?? "", roles: user.roles, source: "web" }, code, new Date(Date.now() + CODE_TTL_MS)));
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    url: `https://t.me/${result.botUsername}?start=${code}`,
    code,
  };
}

export async function unlinkTelegram(): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  await prisma.$transaction(tx => unlinkTelegramInTransaction(tx, { id: user.id, name: user.name ?? "", roles: user.roles, source: "web" }, user.id));
  return { ok: true };
}

// ─── Отвязка администратором (управление пользователями) ────────────────────

export async function getTelegramLinkStatusFor(
  userId: string,
): Promise<{ linked: boolean; username: string | null }> {
  await requireAdmin();
  const link = await prisma.telegramLink.findUnique({ where: { userId } });
  return { linked: !!link?.chatId, username: link?.username ?? null };
}

export async function unlinkTelegramFor(userId: string): Promise<{ ok: boolean }> {
  const session = await requireAdmin();
  await prisma.$transaction(tx => unlinkTelegramInTransaction(tx,
    { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, userId));
  return { ok: true };
}
