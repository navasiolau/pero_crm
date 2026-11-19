export const WORK_RATES_SCOPE = "work-rates:read";

export function isWorkRatesOnly(scopes: readonly string[]): boolean {
  return scopes.length === 1 && scopes[0] === WORK_RATES_SCOPE;
}
