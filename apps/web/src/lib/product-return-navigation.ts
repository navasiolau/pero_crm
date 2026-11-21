import { MAX_LIST_QUERY_LENGTH, normalizeListQuery } from "./list-state";
import { resolveProjectReturn } from "./project-return-navigation";
export type ProductReturnDestination = { href: string; label: string };
export function projectProductsHref(projectId: string, projectReturn?: unknown): string {
  const parent = `/projects/${encodeURIComponent(projectId)}?tab=products`;
  const list = resolveProjectReturn(projectReturn);
  return list === "/projects" ? parent : `${parent}&${new URLSearchParams({ returnTo: list })}`;
}
export function globalProductsHref(query: string): string {
  return `/products?${normalizeListQuery("products", query)}`;
}
export function productDetailHref(productId: string, returnTo: string): string {
  const query = new URLSearchParams({ returnTo });
  return `/products/${encodeURIComponent(productId)}?${query}`;
}
// Принимаем только два точных внутренних пути. История браузера и referrer
// не являются доказательством допустимого источника перехода.
export function resolveProductReturn(value: unknown, actualProjectId: string): ProductReturnDestination {
  const parent = projectProductsHref(actualProjectId);
  const fallback = { href: parent, label: "Назад к изделиям проекта" };
  if (typeof value !== "string" || /[\\#\u0000-\u001f\u007f]/.test(value)) return fallback;
  const nestedParent = `${parent}&returnTo=`;
  // Вложенный query уже закодирован для URL списка, а в ссылке проекта кодируется ещё раз.
  if (value.startsWith(nestedParent) && value.length <= nestedParent.length + 3 * (MAX_LIST_QUERY_LENGTH + "/projects?".length)) {
    const query = new URLSearchParams(value.slice(parent.length + 1));
    if (query.size === 1) return { ...fallback, href: projectProductsHref(actualProjectId, query.get("returnTo")) };
  }
  if (value.length > MAX_LIST_QUERY_LENGTH + "/products?".length) return fallback;
  if (value === "/products") return { href: globalProductsHref(""), label: "Назад к списку изделий" };
  if (value.startsWith("/products?")) return { href: globalProductsHref(value.slice("/products?".length)), label: "Назад к списку изделий" };
  return fallback;
}
export function resolveProjectTab(value: unknown, availableTabs: readonly string[]): string {
  return typeof value === "string" && availableTabs.includes(value) ? value : "overview";
}
