import type { Role } from "@prisma/client";

export const DEFAULT_CASH_ACCOUNT_MANAGE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "PROCUREMENT"];

export type DefaultCashOption = { id: string; currency: string; active?: boolean; isDefault?: boolean };

/** Применяется только при начале новой операции; сохранённый запрос и ручной ввод живут в состоянии формы. */
export function initialCashAccount(
  accounts: readonly DefaultCashOption[],
  options: { currency?: string; fallback?: "none" | "first" | "currency" } = {},
): { cashAccountId: string; currency: string } {
  const active = accounts.filter(account => account.active !== false);
  const selected = active.find(account => account.isDefault) ??
    (options.fallback === "first" ? active[0] : options.fallback === "currency"
      ? active.find(account => account.currency === options.currency) : undefined);
  return { cashAccountId: selected?.id ?? "", currency: selected?.currency ?? options.currency ?? "BYN" };
}
