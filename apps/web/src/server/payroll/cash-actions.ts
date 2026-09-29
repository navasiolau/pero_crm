"use server";

import { prisma } from "@/lib/prisma";
import { ADVANCE_ROLES } from "@/lib/roles";
import { listCashAccounts } from "@/server/finance/queries";
import { requireRole } from "@/server/require-role";
import { calculateCashPayout, type CashCurrency } from "@/lib/cash-ledger";
import { executeCashPayout, preparedRates } from "./cash-service";

export async function issueAdvance(input: { userId: string; cashAccountId: string; cashAmount: string; expectedCashCurrency: CashCurrency;
  description: string; requestId: string }) {
  const session = await requireRole(ADVANCE_ROLES);
  return executeCashPayout({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" },
    { ...input, kind: "ADVANCE" });
}

export async function previewCashPayout(input: { cashAccountId: string; cashAmount: string; expectedCashCurrency: CashCurrency }) {
  await requireRole(ADVANCE_ROLES);
  try {
    const rates = await preparedRates(input.cashAccountId);
    if (rates.cash.currency !== input.expectedCashCurrency) throw new Error("Валюта кассы изменилась; обновите форму");
    const quote = calculateCashPayout(input.cashAmount, rates);
    return { ok: true as const, preview: quote };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось рассчитать аванс" };
  }
}

export async function listAdvanceOptions() {
  await requireRole(ADVANCE_ROLES);
  const [users, accounts] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, position: true }, orderBy: { name: "asc" } }),
    listCashAccounts(),
  ]);
  return { users, accounts: accounts.filter((account) => account.active) };
}
