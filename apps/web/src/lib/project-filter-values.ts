/** Отсутствующий параметр и пустой набор не ограничивают эту ось. */
export function parseProjectFilterValue(value: string | undefined): string[] | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let values: unknown = [raw];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try { values = JSON.parse(raw); } catch { return undefined; }
  }
  // Некорректный параметр игнорируется целиком; валидный набор не обрезается.
  if (!Array.isArray(values) || values.length === 0 || values.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 128)) return undefined;
  return [...new Set((values as string[]).map((item) => item.trim()))].sort();
}

export function encodeProjectFilterValue(value: readonly string[] | undefined): string | null {
  return !value?.length ? null : JSON.stringify([...new Set(value.map((item) => item.trim()))].sort());
}
