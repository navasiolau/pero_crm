"use server";

import { auth } from "@/auth";

// Сохраняем старые server actions для открытых вкладок; ни один не обращается к TimeEntry.
async function retired() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return { ok: false, error: "Учёт времени задач отключён. Обновите страницу" };
}

export async function getActiveTimer(): Promise<null> {
  await retired();
  return null;
}

export async function startTimer(taskId: string): Promise<{ ok: boolean; error?: string }> {
  void taskId;
  return retired();
}

export async function stopTimer(): Promise<{ ok: boolean; minutes?: number; error?: string }> {
  return retired();
}

export async function addManualTime(input: { taskId: string; minutes: number }): Promise<{ ok: boolean; error?: string }> {
  void input;
  return retired();
}

export async function spentMinutes(taskId: string): Promise<never> {
  void taskId;
  const result = await retired();
  throw new Error(result.error);
}
