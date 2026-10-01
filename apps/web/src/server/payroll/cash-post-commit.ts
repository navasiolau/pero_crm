import { formatAmount } from "@/lib/format";

type PayoutResult = { repeated: boolean; payoutId: string; amount: string; cashAmount: string; currency: string;
  payrollCurrency: string; userId: string; userName?: string; month: string; eventId: string | null };
type PayoutContext = { kind: "ADVANCE" | "SALARY"; description?: string; comment?: string };
type PersonNotification = { userId: string; type: string; title: string; body?: string; link: string };
type OrgNotification = { type: string; title: string; body?: string; link: string; exceptUserId: string };
export type CashPayoutEffects = { dispatchEvent(id: string): Promise<unknown>; notifyPerson(input: PersonNotification): Promise<unknown>;
  notifyOrg(input: OrgNotification): Promise<unknown>; revalidatePath(path: string): unknown };

async function safe(effect: () => unknown | Promise<unknown>): Promise<void> {
  try { await effect(); } catch { /* Committed money movement remains successful; retry must not create another payout. */ }
}

export async function deliverCashPayout(result: PayoutResult, input: PayoutContext, actorId: string, effects: CashPayoutEffects): Promise<void> {
  if (result.repeated) return;
  if (result.eventId) await safe(() => effects.dispatchEvent(result.eventId!));
  const body = input.kind === "ADVANCE" ? input.description?.trim() : input.comment?.trim() || `Расчётный месяц ${result.month}`;
  await safe(() => effects.notifyPerson({ userId: result.userId, type: "payroll.payout",
    title: `${input.kind === "ADVANCE" ? "Аванс" : "Выплата зарплаты"}: ${formatAmount(Number(result.amount), result.payrollCurrency)}`,
    body, link: "/payroll" }));
  await safe(() => effects.notifyOrg({ type: "payroll.orgPayout",
    title: `${input.kind === "ADVANCE" ? "Аванс" : "Выплата"}: ${result.userName}, ${formatAmount(Number(result.amount), result.payrollCurrency)}`,
    body, link: "/finance/payroll", exceptUserId: actorId }));
  for (const path of ["/payroll", "/finance/payroll", "/finance/accounts", "/advances"]) {
    await safe(() => effects.revalidatePath(path));
  }
}
