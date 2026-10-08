import type {Prisma} from '@prisma/client';
/** Отменённая закупка не влияет на баланс, расходы или денежный оборот. */
export const activePaymentWhere = {deletionId:null} satisfies Prisma.PaymentWhereInput;
