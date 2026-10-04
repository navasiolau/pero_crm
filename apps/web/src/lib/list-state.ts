import { PRODUCT_STATUSES } from "./product-statuses";
import { STAGES } from "./stages";
import { encodeProjectFilterValue, parseProjectFilterValue } from "./project-filter-values";

export type ListSection = "projects" | "products";
export type ListSearchParams = Record<string, string | string[] | undefined>;
export const DEFAULT_LIST_QUERY = "view=kanban";

const sortFields: Record<ListSection, readonly string[]> = {
  projects: ["number", "title", "client", "stage", "manager", "products"],
  products: ["number", "title", "project", "client", "status", "price", "quantity"],
};

export function isListSection(section: unknown): section is ListSection {
  return section === "projects" || section === "products";
}

export function searchParamsQuery(params: ListSearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) query.set(key, first);
  }
  return query.toString();
}

export function resolveListState(
  section: ListSection,
  params: ListSearchParams,
  saved: string | null,
  legacyView: string | null = null,
) {
  // Наличие любого явного query исключает подмешивание скрытых предпочтений.
  if (Object.keys(params).length > 0) {
    return normalizeListQuery(section, searchParamsQuery(params));
  }
  if (saved !== null) return decodeListPreference(section, saved) ?? DEFAULT_LIST_QUERY;
  return legacyView === "table" ? "view=table" : DEFAULT_LIST_QUERY;
}

export function normalizeListQuery(section: ListSection, query: string) {
  const source = new URLSearchParams(query);
  const get = (key: string) => source.get(key)?.trim() ?? "";
  const result = new URLSearchParams({ view: get("view") === "table" ? "table" : "kanban" });
  const q = get("q").slice(0, 100);
  if (q) result.set("q", q);
  if (section === "projects") {
    for (const key of ["client", "manager", "engineer", "stage"]) {
      let values = parseProjectFilterValue(source.get(key) ?? undefined);
      if (key === "stage" && values?.some((value) => !STAGES.some((item) => item.id === value))) values = [];
      const encoded = encodeProjectFilterValue(values);
      if (encoded !== null) result.set(key, encoded);
    }
    if (get("active") === "1" || get("active") === "0") result.set("active", get("active"));
  } else {
    for (const key of ["project", "client", "engineer"]) {
      const value = get(key);
      if (value && value.length <= 128) result.set(key, value);
    }
    if (PRODUCT_STATUSES.some((item) => item.id === get("status"))) result.set("status", get("status"));
    if (get("active") === "0") result.set("active", "0");
  }
  if (sortFields[section].includes(get("sort"))) result.set("sort", get("sort"));
  if (get("dir") === "asc" || get("dir") === "desc") result.set("dir", get("dir"));
  const page = Number(get("page"));
  if (Number.isSafeInteger(page) && page > 1 && page <= 2_147_483_647) result.set("page", String(page));
  const pageSize = Number(get("pageSize"));
  if ([10, 20, 50, 100].includes(pageSize)) result.set("pageSize", String(pageSize));
  return result.toString();
}

export function updateListQuery(section: ListSection, query: string, updates: Record<string, string | null>) {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  // Централизованно: новый фильтр или сортировка не оставляет пустую позднюю страницу.
  if (Object.keys(updates).some((key) => key !== "page" && key !== "view")) params.delete("page");
  return normalizeListQuery(section, params.toString());
}

export function encodeListPreference(section: ListSection, query: string, revision: string) {
  return JSON.stringify({ version: section === "projects" ? 2 : 1, revision, query: normalizeListQuery(section, query) });
}

export function decodeListPreference(section: ListSection, value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) ||
      (parsed.version !== 1 && !(section === "projects" && parsed.version === 2)) ||
      !("query" in parsed) || typeof parsed.query !== "string") return null;
    const query = new URLSearchParams(parsed.query);
    // V1 отсутствие active означало true. CAS продолжает использовать исходную строку.
    if (section === "projects" && parsed.version === 1 && query.get("active")?.trim() !== "0") query.set("active", "1");
    return normalizeListQuery(section, query.toString());
  } catch {
    return null;
  }
}
