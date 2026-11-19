import type { Prisma } from "@prisma/client";

export const activePayoutWhere = { deletedAt: null } satisfies Prisma.PayoutWhereInput;
