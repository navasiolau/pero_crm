/** Новое значение описания: формат непустого текста сохраняется буквально. */
export function normalizeProductDescription(value: string | null | undefined): string | null {
  return value == null || value.trim().length === 0 ? null : value;
}

/** Сравнение исходных значений до нормализации; baseline всегда остаётся raw. */
export function isProductDescriptionUnchanged(value: string | null, expectedValue: string | null): boolean {
  return value === expectedValue;
}
