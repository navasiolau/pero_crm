import type { Prisma } from "@prisma/client";

// Общие контакты намеренно перечислены: новые приватные скаляры сюда не попадут.
export const publicClientSelect = {
  id: true, name: true, lastName: true, middleName: true,
  phone: true, email: true, address: true, comment: true,
  legacyId: true, legacyTable: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ClientSelect;
