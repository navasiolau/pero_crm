import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getNbrbRate } from "@/server/finance/nbrb";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { isCashCurrency, parseCashRate, type CashCurrency, type CashRates } from "@/lib/cash-ledger";
import { issuePayoutCore, type CashPayoutInput, type PayoutActor } from "./cash-core";
import { deliverCashPayout } from "./cash-post-commit";

export async function preparedRates(cashAccountId: string): Promise<CashRates> {
  const asOf = new Date().toISOString().slice(0, 10);
  const [account] = await Promise.all([
    prisma.cashAccount.findUnique({ where: { id: cashAccountId }, select: { currency: true, active: true } }),
  ]);
  if (!account?.active || !isCashCurrency(account.currency)) throw new Error("Активная касса не найдена");
  const payrollCurrency = "BYN";
  if (!isCashCurrency(payrollCurrency)) throw new Error("Неизвестная валюта зарплаты");
  const rateFor = async (currency: CashCurrency) => {
    if (currency === "BYN") return { currency, rate: "1.000000", date: asOf };
    const value = await getNbrbRate(currency, new Date(`${asOf}T12:00:00.000Z`));
    if (!Number.isFinite(value.rate) || !/^\d+(?:\.\d{1,6})?$/.test(String(value.rate))) throw new Error("Некорректный курс НБ РБ");
    return { currency, rate: parseCashRate(value.rate.toFixed(6), currency), date: value.date };
  };
  try {
    const cash = await rateFor(account.currency);
    const payroll = payrollCurrency === account.currency ? cash : await rateFor(payrollCurrency);
    return { asOf, cash, payroll };
  } catch {
    throw new Error("Не удалось получить корректный курс НБ РБ для выдачи");
  }
}

export async function executeCashPayout(actor: PayoutActor, input: CashPayoutInput): Promise<{
  ok: boolean; error?: string; payoutId?: string; repeated?: boolean; cashAmount?: string; cashCurrency?: string;
  payrollAmount?: string; payrollCurrency?: string; bynAmount?: string | null;
}> {
  try {
    // A committed receipt must be replayable even if NBRB is currently unavailable.
    const existing = /^[0-9a-f-]{36}$/i.test(input.requestId)
      ? await prisma.changeLog.findUnique({ where: { id: `payout-issue:${input.requestId}` }, select: { id: true } }) : null;
    const byn = { currency: "BYN" as const, rate: "1.000000", date: new Date().toISOString().slice(0, 10) };
    const rates = existing ? { asOf: new Date().toISOString().slice(0, 10), cash: byn, payroll: byn } : await preparedRates(input.cashAccountId);
    const result = await withTaskTransaction((tx) => issuePayoutCore(actor, input, rates, tx));
    await deliverCashPayout(result, input, actor.id, { dispatchEvent, notifyPerson, notifyOrg, revalidatePath });
    return { ok: true, payoutId: result.payoutId, repeated: result.repeated, cashAmount: result.cashAmount,
      cashCurrency: result.currency, payrollAmount: result.amount, payrollCurrency: result.payrollCurrency, bynAmount: result.bynAmount };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось внести выплату" };
  }
}
