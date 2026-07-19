import type { Role } from "@prisma/client";
import {
  Banknote,
  ClipboardCheck,
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  Receipt,
  Settings,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export const roleLabels: Record<Role, string> = {
  ADMIN: "Администратор",
  DIRECTOR: "Директор",
  MANAGER: "Менеджер",
  ENGINEER: "Инженер",
  WORKER: "Работник",
  MOUNTER: "Монтажник",
};

// Группы навигации в сайдбаре: «Основное» и «Управление»
export type NavGroup = "main" | "manage";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  group: NavGroup;
};

const OFFICE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"];
const ADMIN_ROLES: Role[] = ["ADMIN", "DIRECTOR"];
const ALL_ROLES: Role[] = [
  "ADMIN",
  "DIRECTOR",
  "MANAGER",
  "ENGINEER",
  "WORKER",
  "MOUNTER",
];
// Директору зарплата не считается (§4 плана)
const PAYROLL_ROLES: Role[] = ["ADMIN", "MANAGER", "ENGINEER", "WORKER", "MOUNTER"];

export const navItems: NavItem[] = [
  // У работника и монтажника дашборда нет — их главный экран «Мои задачи»
  { href: "/", label: "Дашборд", icon: LayoutDashboard, roles: OFFICE_ROLES, group: "main" },
  { href: "/my", label: "Мои задачи", icon: ClipboardCheck, roles: ALL_ROLES, group: "main" },
  { href: "/payroll", label: "Моя зарплата", icon: Wallet, roles: PAYROLL_ROLES, group: "main" },
  { href: "/projects", label: "Проекты", icon: FolderKanban, roles: OFFICE_ROLES, group: "manage" },
  { href: "/clients", label: "Клиенты", icon: Users, roles: OFFICE_ROLES, group: "manage" },
  { href: "/tasks", label: "Задачи", icon: ListChecks, roles: OFFICE_ROLES, group: "manage" },
  { href: "/prices", label: "Прайсы", icon: Receipt, roles: OFFICE_ROLES, group: "manage" },
  { href: "/warehouse", label: "Склад", icon: Warehouse, roles: OFFICE_ROLES, group: "manage" },
  { href: "/finance", label: "Финансы", icon: Banknote, roles: ADMIN_ROLES, group: "manage" },
  { href: "/changelog", label: "Журнал", icon: History, roles: ADMIN_ROLES, group: "manage" },
  { href: "/settings", label: "Настройки", icon: Settings, roles: ADMIN_ROLES, group: "manage" },
];

export function navItemsForRole(role: Role): NavItem[] {
  return navItems.filter((item) => item.roles.includes(role));
}

export function sectionTitle(pathname: string): string {
  const match = navItems.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  return match?.label ?? "PERO CRM";
}
