/** Отсутствующий параметр и пустой набор не ограничивают эту ось. */
export function parseListFilterValue(value: string | undefined): string[] | undefined {
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

export function encodeListFilterValue(value: readonly string[] | undefined): string | null {
  return !value?.length ? null : JSON.stringify([...new Set(value.map((item) => item.trim()))].sort());
}

export const ALL_LIST_FILTER_VALUE = '{"all":true}';

export function isAllListFilterValue(value: string | undefined): boolean {
  if (!value?.trim().startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return !!parsed && typeof parsed === "object" && Object.keys(parsed).length === 1 && "all" in parsed && parsed.all === true;
  } catch { return false; }
}

/** Полный явный выбор сохраняет галочки, не ограничивая серверную выборку. */
export function parseListFilterUiValue(value: string | undefined, options: readonly { value: string }[]): string[] | undefined {
  return isAllListFilterValue(value) ? options.map(option => option.value) : parseListFilterValue(value);
}

export function encodeListFilterUiValue(value: readonly string[] | undefined, options: readonly { value: string }[]): string | null {
  const selected = new Set(value);
  const known = new Set(options.map(option => option.value));
  return known.size > 0 && selected.size === known.size && [...known].every(id => selected.has(id))
    ? ALL_LIST_FILTER_VALUE : encodeListFilterValue(value);
}

/** Удалённый из рабочего процесса статус не сбрасывает соседние действующие значения. */
export function activeListStatusValues(values: string[] | undefined, allowed: readonly { id: string }[], retired: readonly string[]): string[] | undefined {
  const active = values?.filter(value => !retired.includes(value));
  return active?.length && active.every(value => allowed.some(item => item.id === value)) ? active : undefined;
}
