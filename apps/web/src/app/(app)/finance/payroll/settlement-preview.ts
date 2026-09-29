export function settlementConfirmationDisabled(
  cashBalance: number,
  payrollUpperBound: number,
  pending: boolean,
): boolean {
  return pending || cashBalance <= 0 || payrollUpperBound <= 0;
}

export function didSettleAnything(result: {
  ok: boolean;
  paidCount?: number;
  totalPaid?: number;
}): boolean {
  return result.ok && (result.paidCount ?? 0) > 0 && (result.totalPaid ?? 0) > 0;
}

export function settlementPreviewDisclosure(payrollCurrency: string, cashCurrency: string): string {
  return `Показана верхняя граница в валюте зарплаты (${payrollCurrency}); она не пересчитана в валюту выбранной кассы (${cashCurrency}). Фактические выплаты могут быть меньше из-за остатка кассы, курса и проверки долга сервером.`;
}
