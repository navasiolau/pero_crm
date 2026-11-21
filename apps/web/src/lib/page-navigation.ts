import { navItems, sectionTitle } from "./nav";

export type PageDestination = { href: string; label: string };
export type PageVisit = { href: string; key?: string };

const sections = new Set([...navItems.map(item => item.href), "/plan", "/kp", "/notifications"]);

const returnLabels: Record<string, string> = {
  "/finance": "Назад к финансам",
  "/finance/accounts": "К кассам",
  "/finance/projects": "Назад к финансовым проектам",
  "/settings": "К настройкам",
  "/settings/modules": "К списку модулей",
  "/plan": "К личному плану",
  "/projects": "К списку проектов",
  "/kp": "К КП и договорам",
  "/warehouse": "На склад",
  "/notifications": "К уведомлениям",
};

export function isCrmPage(href: unknown): href is string {
  if (typeof href !== "string" || !/^\/(?!\/)/.test(href) || /[\\#\u0000-\u001f]/.test(href)) return false;
  const path = href.split("?")[0];
  return sections.has("/" + path.split("/")[1]) && new URL(href, "https://crm.invalid").pathname === path;
}

export function resolvePageBack(pathname: string, home: string, previous: string | null, explicit?: PageDestination): PageDestination | null {
  if (explicit) return explicit;
  const parent = pathname.slice(0, Math.max(0, pathname.lastIndexOf("/")));
  const href = parent || (isCrmPage(previous) ? previous : home);
  const path = href.split("?")[0];
  if (path === pathname) return null;
  return { href, label: returnLabels[path] ?? `Назад в раздел «${sectionTitle(path)}»` };
}

export function visitPage(trail: PageVisit[], current: PageVisit): PageVisit[] {
  const last = trail.at(-1);
  if (last?.href.split("?")[0] === current.href.split("?")[0]) return [...trail.slice(0, -1), current];
  return [...trail, current];
}
