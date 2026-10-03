import { normalizeListQuery } from "./list-state";
export type ProductReturnDestination = { href: string; label: string };
export function projectProductsHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=products`;
}
export function globalProductsHref(query: string): string {
  return `/products?${normalizeListQuery("products", query)}`;
}
export function productDetailHref(number: string, returnTo: string): string {
  const query = new URLSearchParams({ returnTo });
  return `/products/${encodeURIComponent(number)}?${query}`;
}
// Принимаем только два точных внутренних пути. История браузера и referrer
// не являются доказательством допустимого источника перехода.
export function resolveProductReturn(value: unknown, actualProjectId: string): ProductReturnDestination {
  const parent = projectProductsHref(actualProjectId);
  const fallback = { href: parent, label: "Назад к изделиям проекта" };
  if (typeof value !== "string" || value.length > 4096 || /[\\#\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value === parent) return fallback;
  if (value === "/products") return { href: globalProductsHref(""), label: "Назад к списку изделий" };
  if (value.startsWith("/products?")) return { href: globalProductsHref(value.slice("/products?".length)), label: "Назад к списку изделий" };
  return fallback;
}
export function resolveProjectTab(value: unknown, availableTabs: readonly string[]): string {
  return typeof value === "string" && availableTabs.includes(value) ? value : "overview";
}
