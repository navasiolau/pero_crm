/** Отсутствующий параметр — все; явный пустой набор — ничего. */
export function parseProjectFilterValue(value: string | undefined): string[] | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let values: unknown = [raw];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try { values = JSON.parse(raw); } catch { return []; }
  }
  // Невалидный набор не превращается во «все» и не обрезается частично.
  if (!Array.isArray(values) || values.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 128)) return [];
  return [...new Set((values as string[]).map((item) => item.trim()))].sort();
}

export function encodeProjectFilterValue(value: readonly string[] | undefined): string | null {
  return value === undefined ? null : JSON.stringify([...new Set(value.map((item) => item.trim()))].sort());
}
