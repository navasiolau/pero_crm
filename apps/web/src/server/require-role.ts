import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { Role } from "@prisma/client";

// Проверка роли для server actions и страниц.
// Возвращает сессию или выбрасывает redirect/ошибку.
export async function requireRole(roles: Role[]) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!roles.includes(session.user.role)) {
    throw new Error("Недостаточно прав");
  }
  return session;
}

export async function requireAdmin() {
  return requireRole(["ADMIN", "DIRECTOR"]);
}
