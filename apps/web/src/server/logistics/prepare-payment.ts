import { Prisma } from "@prisma/client";
import { getNbrbRate, isCurrency } from "@/server/finance/nbrb";
import type { PreparedPayment } from "@/server/payments/transaction";
import type { LogisticsPostingData } from "./money-contracts";

/** Только внутренний writer рейса. Обычный preparePayment по-прежнему требует статью расхода. */
export async function prepareLogisticsPayment(data: LogisticsPostingData, date: string,
  db: Pick<Prisma.TransactionClient, "cashAccount">, getRate: typeof getNbrbRate = getNbrbRate): Promise<PreparedPayment> {
  if (!isCurrency(data.currency)) throw Error("Неизвестная валюта");
  const account = await db.cashAccount.findUnique({ where: { id: data.cashAccountId } });
  if (!account?.active) throw Error("Касса не найдена");
  if (account.currency !== data.currency) throw Error(`Касса «${account.name}» в ${account.currency} — выберите кассу в валюте операции`);
  const paidAt = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(paidAt.getTime())) throw Error("Некорректная дата платежа");
  const amount = new Prisma.Decimal(data.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  let rate: number, rateDate: Date | null = null;
  if (data.currency === "BYN") rate = 1;
  else if (data.rate) {
    rate = data.rate;
    rateDate = data.rateDate ? new Date(`${data.rateDate}T12:00:00`) : paidAt;
  } else {
    try {
      const fetched = await getRate(data.currency, paidAt);
      rate = fetched.rate; rateDate = new Date(`${fetched.date}T12:00:00`);
    } catch { throw Error("Не удалось получить курс НБ РБ — введите курс вручную"); }
  }
  rate = new Prisma.Decimal(rate).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isFinite(rate) || rate <= 0 || rateDate && !Number.isFinite(rateDate.getTime())) throw Error("Некорректный курс или дата курса");
  return { project: null, account, articleId: null, paidAt, rate, rateDate, amount: amount.toNumber(),
    bynAmount: amount.times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber() };
}
