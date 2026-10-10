import {
  Banknote,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  Package,
  Receipt,
  Settings,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import {
  ASSIGNEE_ROLES,
  FIELD_ROLES,
  FINANCE_ROLES,
  MANAGER_ROLES,
  OFFICE_ROLES,
  canReadPrices,
  type Role,
} from "@/lib/roles";

// re-export для совместимости: подписи ролей теперь живут в lib/roles
export { roleLabels } from "@/lib/roles";

// Группы навигации в сайдбаре: «Основное» и «Управление»
export type NavGroup = "main" | "manage";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  group: NavGroup;
};

const ALL_ROLES: Role[] = [...OFFICE_ROLES, ...FIELD_ROLES];
// Директору зарплата не считается (§4)
const PAYROLL_ROLES: Role[] = ALL_ROLES.filter((role) => role !== "DIRECTOR");

export const navItems: NavItem[] = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard, roles: MANAGER_ROLES, group: "main" },
  { href: "/my", label: "Мои задачи", icon: ClipboardCheck, roles: ASSIGNEE_ROLES, group: "main" },
  { href: "/payroll", label: "Моя зарплата", icon: Wallet, roles: PAYROLL_ROLES, group: "main" },
  { href: "/projects", label: "Проекты", icon: FolderKanban, roles: OFFICE_ROLES, group: "manage" },
  { href: "/products", label: "Изделия", icon: Package, roles: [...OFFICE_ROLES,...FIELD_ROLES], group: "manage" },
  { href: "/clients", label: "Клиенты", icon: Users, roles: OFFICE_ROLES, group: "manage" },
  { href: "/tasks", label: "Задачи", icon: ListChecks, roles: OFFICE_ROLES, group: "manage" },
  { href: "/prices", label: "Прайсы", icon: Receipt, roles: [...OFFICE_ROLES, "WORK_COORDINATOR"], group: "manage" },
  { href: "/warehouse", label: "Склад", icon: Warehouse, roles: OFFICE_ROLES, group: "manage" },
  { href: "/finance", label: "Финансы", icon: Banknote, roles: FINANCE_ROLES, group: "manage" },
  { href: "/changelog", label: "Журнал", icon: History, roles: ["ADMIN"], group: "manage" },
  { href: "/settings", label: "Настройки", icon: Settings, roles: MANAGER_ROLES, group: "manage" },
];

// Видимые пункты = объединение по всем ролям пользователя
// (комбинированные роли: менеджер+инженер видит оба набора разделов).
const planItem: NavItem = {href: "/plan", label: "План", icon: CalendarDays, roles: ALL_ROLES, group: "main"};
export function navItemsForRole(roles: Role[], calendarEnabled = false): NavItem[] {
  const visible = navItems.filter((item) =>
    item.href === "/prices" ? canReadPrices(roles) : item.roles.some((role) => roles.includes(role)),
  );
  if (calendarEnabled) visible.splice(visible.findIndex(item => item.href === "/") + 1, 0, planItem);
  return visible;
}

export function sectionTitle(pathname: string): string {
  const match = [...navItems, planItem].find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  return match?.label ?? "PERO CRM";
}
