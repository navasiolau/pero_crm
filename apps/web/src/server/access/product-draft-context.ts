import type { Prisma } from "@prisma/client";

/** Общий серверный контекст для проверки конкретного черновика КП. */
export const productDraftAccessRelations = {
  project: { select: { id: true, deletedAt: true } },
  proposalItem: { select: { deletedAt: true, proposal: { select: {
    projectId: true, deletedAt: true,
    project: { select: { id: true, deletedAt: true } },
  } } } },
} satisfies Prisma.ProductInclude;

export const productDraftAccessSelect = {
  projectId: true, deletedAt: true, ...productDraftAccessRelations,
} satisfies Prisma.ProductSelect;
