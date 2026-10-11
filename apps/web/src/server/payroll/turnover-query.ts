import { Prisma } from "@prisma/client";
import { INTERNAL_CURRENCY } from "@/lib/internal-currency";
import { payrollMonthRange } from "@/lib/payroll-month";
import { activePaymentWhere } from "@/server/payments/active-records";

export async function readMonthTurnoverSnapshot(month: string, database: Pick<Prisma.TransactionClient, "payment">) {
  const { start, end } = payrollMonthRange(month);
  const aggregate = await database.payment.aggregate({
    where: { ...activePaymentWhere, paidAt: { gte: start, lt: end }, direction: "INCOME" },
    _sum: { bynAmount: true }, _count: { _all: true },
  });
  return { total: new Prisma.Decimal(aggregate._sum.bynAmount ?? 0), paymentsCount: aggregate._count._all,
    currency: INTERNAL_CURRENCY, start, end };
}