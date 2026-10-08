import type { PaymentData } from "./contracts";

/** Только новые обычные денежные операции; точный receipt проверяется до этого правила. */
export function assertExpenseReportDocument(data: Pick<PaymentData, "direction" | "reportDocumentId">) {
  if (data.direction === "EXPENSE" && !data.reportDocumentId)
    throw Error("Прикрепите отчетный документ — без него расход создать нельзя");
}
