import type { PaymentData } from "./contracts";
import { inputReportDocumentIds } from "@/server/finance-documents/input";

/** Только новые обычные денежные операции; точный receipt проверяется до этого правила. */
export function assertExpenseReportDocument(data: Pick<PaymentData, "direction" | "reportDocumentId" | "reportDocumentIds">) {
  if (data.direction === "INCOME" && inputReportDocumentIds(data).length)
    throw Error("Документы доступны только для расхода");
  if (data.direction === "EXPENSE" && !inputReportDocumentIds(data).length)
    throw Error("Прикрепите отчетный документ — без него расход создать нельзя");
}
