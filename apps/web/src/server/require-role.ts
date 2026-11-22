import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { TELEGRAM_SECTION_DENIED } from "@/server/telegram/access";
import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import type { Role } from "@prisma/client";

import { ADMIN_ROLES, FINANCE_ROLES, PAYROLL_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

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

// Общий финансовый доступ (§10–§11): авансы, приходы/расходы, кассы, статьи.
// Бухгалтер — полный доступ к финансам, но без настроек и журнала.
export async function requireFinanceRole(allowed: Role[]) {
  const session = await scopedFinanceAuth();
  if (!session?.user) redirect("/login");
  if (!hasAnyRole(session.user.roles, allowed)) {
    throw new Error("telegramFinance" in session ? TELEGRAM_SECTION_DENIED : "Недостаточно прав");
  }
  return session;
}

export async function requireFinance() {
  return requireFinanceRole(FINANCE_ROLES);
}

export async function requirePayrollManagement() {
  return requireFinanceRole(PAYROLL_MANAGE_ROLES);
}
