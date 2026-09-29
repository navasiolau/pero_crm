import type { CashCurrency } from "@/lib/cash-ledger";

export type FrozenCashPayoutRequest = {
  mode: "ADVANCE" | "SALARY";
  requestId: string;
  month?: string;
  payload: {
    userId: string;
    cashAccountId: string;
    cashAmount: string;
    expectedCashCurrency: CashCurrency;
    description: string;
  };
};

export function buildSalaryPayoutRetry(
  request: Pick<FrozenCashPayoutRequest, "requestId" | "month" | "payload">,
  fallbackMonth: string,
) {
  return {
    userId: request.payload.userId,
    cashAccountId: request.payload.cashAccountId,
    cashAmount: request.payload.cashAmount,
    expectedCashCurrency: request.payload.expectedCashCurrency,
    requestId: request.requestId,
    month: request.month ?? fallbackMonth,
    kind: "SALARY" as const,
    comment: request.payload.description || undefined,
  };
}

export function salaryRetryBlockedByLimit(isRetry: boolean, limitExceeded: boolean): boolean {
  return !isRetry && limitExceeded;
}
