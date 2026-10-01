/** Единица новых внутренних денег. Валюты физических касс этим правилом не ограничены. */
export const INTERNAL_CURRENCY = "BYN" as const;
export const INTERNAL_CURRENCY_ERROR = "Внутренние суммы CRM используют только BYN";
export const PROJECT_CURRENCY_ERROR = "Сначала подготовьте суммы и валюту проекта в BYN";

export function assertInternalCurrency(currency: string | null | undefined): asserts currency is typeof INTERNAL_CURRENCY {
  if (currency !== INTERNAL_CURRENCY) throw new Error(INTERNAL_CURRENCY_ERROR);
}

export function assertProjectMoneyCurrency(currency: string): asserts currency is typeof INTERNAL_CURRENCY {
  if (currency !== INTERNAL_CURRENCY) throw new Error(PROJECT_CURRENCY_ERROR);
}
