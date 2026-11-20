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
  return { ok: await setUserPreference({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, key, value) };
}
