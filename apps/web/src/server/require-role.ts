import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { Role } from "@prisma/client";

import { ADMIN_ROLES, FINANCE_ROLES, hasAnyRole } from "@/lib/roles";

// Проверка ролей для server actions и страниц (§4, комбинированные роли:
// достаточно любой из перечисленных). Возвращает сессию или выбрасывает
// redirect/ошибку.
export async function requireRole(allowed: Role[]) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!hasAnyRole(session.user.roles, allowed)) {
    throw new Error("Недостаточно прав");
  }
  return session;
}

export async function requireAdmin() {
  return requireRole(ADMIN_ROLES);
}

// Финансовый доступ (§10–§11): выплаты/авансы, приходы/расходы, кассы, статьи.
// Бухгалтер — полный доступ к финансам, но без настроек и журнала.
export async function requireFinance() {
  return requireRole(FINANCE_ROLES);
}
