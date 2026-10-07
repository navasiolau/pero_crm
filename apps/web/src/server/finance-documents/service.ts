import { prisma } from "@/lib/prisma";
import { createFinanceDocumentService } from "./core";
import { financeDocumentStorage } from "./storage";

export const financeDocuments = createFinanceDocumentService({
  transaction: operation => prisma.$transaction(operation, { maxWait: 5_000, timeout: 15_000 }),
  storage: financeDocumentStorage,
});
