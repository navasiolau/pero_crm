import type {Prisma} from '@prisma/client';
/** Отменённая закупка и прежняя ревизия рейса остаются историей без влияния на баланс. */
export const activePaymentWhere = {
  deletedAt: null,
  deletionId: null,
  OR: [{ logisticsAllocationId: null }, { logisticsAllocation: { posting: { status: "ACTIVE", trip: { deletedAt: null } } } }],
} satisfies Prisma.PaymentWhereInput;
