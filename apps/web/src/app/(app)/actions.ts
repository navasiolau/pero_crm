"use server";

import { unstable_rethrow } from "next/navigation";

import { signOut } from "@/auth";

export async function logout(): Promise<string | undefined> {
  try {
    await signOut({ redirectTo: "/login" });
  } catch (error) {
    // Штатный NEXT_REDIRECT должен завершить выход, а не стать ошибкой формы.
    unstable_rethrow(error);
    return "Не удалось выйти. Попробуйте ещё раз.";
  }
}
