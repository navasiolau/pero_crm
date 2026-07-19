"use server";

import { auth } from "@/auth";

import { setUserPreference } from "@/server/preferences";

// Сохранение UI-предпочтения (вид раздела канбан/таблица и пр., §7).
export async function saveViewPreference(
  key: string,
  value: string,
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  await setUserPreference(session.user.id, key, value);
  return { ok: true };
}
