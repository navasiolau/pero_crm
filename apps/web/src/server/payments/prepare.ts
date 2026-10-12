import { Prisma, type PrismaClient } from "@prisma/client";
import { liveProjectWhere } from "@/server/access/live-entities";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { getNbrbRate, isCurrency } from "@/server/finance/nbrb";
import type { PaymentDetails } from "./contracts";
import type { PreparedPayment } from "./transaction";

/** Shared web/bot/stock preparation. Network work stays outside the money transaction. */
export async function preparePayment(data: PaymentDetails,
  db: Pick<PrismaClient, "project" | "cashAccount" | "expenseArticle">,
  getRate: typeof getNbrbRate = getNbrbRate): Promise<PreparedPayment> {
  if (!isCurrency(data.currency)) throw Error("Неизвестная валюта");
  const project = data.projectId ? await db.project.findUnique({
    where: { ...liveProjectWhere, id: data.projectId }, select: { id: true, number: true, currency: true },
  }) : null;
  if (data.projectId && !project) throw Error("Проект не найден");
  if (project) assertProjectMoneyCurrency(project.currency);
  const account = await db.cashAccount.findUnique({ where: { id: data.cashAccountId } });
  if (!account || !account.active) throw Error("Касса не найдена");
  if (account.currency !== data.currency) throw Error(`Касса «${account.name}» в ${account.currency} — выберите кассу в валюте операции`);
  let articleId: string | null = null;
  if (data.direction === "EXPENSE" && !data.expenseArticleId) throw Error("Выберите статью расхода");
  if (data.expenseArticleId) {
    const article = await db.expenseArticle.findUnique({ where: { id: data.expenseArticleId } });
    if (!article || !article.active) throw Error("Статья расхода не найдена");
    articleId = article.id;
  }
  const paidAt = data.paidAt ? new Date(`${data.paidAt}T12:00:00`) : new Date();
  if (!Number.isFinite(paidAt.getTime())) throw Error("Некорректная дата платежа");
  const amountDecimal = new Prisma.Decimal(data.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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
  // Match the persisted six-digit rate before computing the saved BYN equivalent.
  rate = new Prisma.Decimal(rate).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isFinite(rate) || rate <= 0 || (rateDate && !Number.isFinite(rateDate.getTime()))) throw Error("Некорректный курс или дата курса");
  return { project, account, articleId, paidAt, rate, rateDate, amount: amountDecimal.toNumber(),
    bynAmount: amountDecimal.times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber() };
}
