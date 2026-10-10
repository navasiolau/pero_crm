import { prisma } from "@/lib/prisma";
import type { LogisticsTransaction } from "./core";
import { createLogisticsDocumentService } from "./documents";
import { logisticsDocumentStorage } from "./storage";

export const logisticsTransaction: LogisticsTransaction = operation => prisma.$transaction(operation, { maxWait: 5_000, timeout: 15_000 });
export const logisticsDocuments = createLogisticsDocumentService({ transaction: logisticsTransaction, storage: logisticsDocumentStorage });
