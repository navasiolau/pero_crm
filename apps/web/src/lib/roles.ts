import type { Role } from "@prisma/client";

export type { Role };

// ─── Комбинированные роли (§4) ────────────────────────────────────────────────
// У сотрудника массив ролей User.roles; права = ОБЪЕДИНЕНИЕ прав всех ролей
// («разрешено, если есть хоть одна подходящая роль» — см. hasAnyRole).
// Отдельные негативные правила и отображение опираются на ПРИОРИТЕТ: старшая
// роль побеждает. ADMIN и DIRECTOR не комбинируются ни с чем (решение
// владельца) — их привилегии особые, «половинчатый» админ недопустим.

// Лестница приоритета: от старшей к младшей.
export const ROLE_VALUES = [
  "ADMIN",
  "DIRECTOR",
  "MANAGER",
  "ENGINEER",
  "PROCUREMENT",
  "ACCOUNTANT",
  "WORKER",
  "MOUNTER",
  "WORK_COORDINATOR",
] as const satisfies readonly Role[];
export const ROLE_PRIORITY: Role[] = [...ROLE_VALUES];
export const ADDITIONAL_ROLES: Role[] = ["WORK_COORDINATOR"];

export const roleLabels: Record<Role, string> = {
  ADMIN: "Администратор",
  DIRECTOR: "Директор",
  MANAGER: "Менеджер",
  ENGINEER: "Инженер",
  WORKER: "Работник",
  MOUNTER: "Монтажник",
  ACCOUNTANT: "Бухгалтер",
  PROCUREMENT: "Снабженец",
  WORK_COORDINATOR: "Ответственный за работы",
};

// Ролевые наборы — единый источник истины (вместо инлайн-массивов по коду).
// Офисные роли: полный просмотр проектов/изделий/клиентов.
export const OFFICE_ROLES: Role[] = [
  "ADMIN",
  "DIRECTOR",
  "MANAGER",
  "ENGINEER",
  "PROCUREMENT",
];
// Менеджмент: создание/правка проектов, задач, изделий, работ.
export const MANAGER_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER"];
// Справочник поставщиков и перевозчиков.
export const COUNTERPARTY_ROLES: Role[] = [...MANAGER_ROLES, "PROCUREMENT"];
// Финансы: приходы/расходы, кассы, статьи и авансы (§10–§11).
export const FINANCE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "ACCOUNTANT", "PROCUREMENT"];
// Управление зарплатой других сотрудников не следует из общего финансового доступа.
export const PAYROLL_MANAGE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "ACCOUNTANT"];
// Авансы — финансовая операция, отдельного права менеджера больше нет.
export const ADVANCE_ROLES: Role[] = [...FINANCE_ROLES];
export const WAREHOUSE_MANAGE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "PROCUREMENT"];
export const WAREHOUSE_MONEY_ROLES: Role[] = [...FINANCE_ROLES];
export const WAREHOUSE_DELETE_ROLES: Role[] = ["ADMIN"];
export const WAREHOUSE_UNIT_ADMIN_ROLES: Role[] = ["ADMIN"];
// Эти прежние офисные writes не следуют из readonly supply/finance grants.
export const OFFICE_WRITE_ROLES: Role[] = [...MANAGER_ROLES,"ENGINEER"];
// Настройки и журнал изменений.
export const ADMIN_ROLES: Role[] = ["ADMIN", "DIRECTOR"];
// Производственный персонал: без дашборда, время — только таймером.
export const FIELD_ROLES: Role[] = ["WORKER", "MOUNTER"];
// Кому можно назначать задачи/работы (исполнители).
export const ASSIGNEE_ROLES: Role[] = [...MANAGER_ROLES, "ENGINEER", ...FIELD_ROLES];

// Есть ли у пользователя конкретная роль.
export function hasRole(userRoles: Role[] | null | undefined, role: Role): boolean {
  return userRoles?.includes(role) ?? false;
}

// Право из набора: объединение прав — достаточно любой из ролей.
export function hasAnyRole(
  userRoles: Role[] | null | undefined,
  needed: Role[],
): boolean {
  return needed.some((role) => userRoles?.includes(role)) ?? false;
}

// Старшая роль по лестнице приоритета — для отображения и спорных правил.
// Пустой массив (теоретически невозможен — БД и валидация требуют минимум
// одну) трактуется как самая ограниченная роль, а не как расширение прав.
export function primaryRole(userRoles: Role[] | null | undefined): Role {
  return baseRoles(userRoles ?? [])[0] ?? "WORKER";
}

/** Добавочные способности не меняют классификацию сотрудника и схему оплаты. */
export function baseRoles(userRoles: readonly Role[]): Role[] {
  return ROLE_PRIORITY.filter(role => !ADDITIONAL_ROLES.includes(role) && userRoles.includes(role));
}

// Дедупликация + канонический порядок по приоритету.
export function normalizeRoles(roles: Role[]): Role[] {
  return ROLE_PRIORITY.filter((role) => roles.includes(role));
}

// Валидация комбинации: минимум одна роль; ADMIN и DIRECTOR — только поодиночке.
export function isValidRolesCombination(roles: Role[]): boolean {
  return roleCombinationError(roles) === null;
}

export function roleCombinationError(roles: readonly Role[]): string | null {
  const normalized = normalizeRoles([...roles]);
  if (normalized.length === 0) return "Выберите хотя бы одну роль";
  if (baseRoles(normalized).length === 0)
    return "Для роли «Ответственный за работы» выберите базовую роль";
  const exclusive = normalized.some((role) => role === "ADMIN" || role === "DIRECTOR");
  return exclusive && normalized.length !== 1
    ? "Роли «Администратор» и «Директор» не сочетаются с другими ролями"
    : null;
}

/** Узкая способность требует допустимой базовой роли, не образуя нового read grant. */
export function hasWorkCoordinator(roles: readonly Role[]): boolean {
  return roles.includes("WORK_COORDINATOR") && isValidRolesCombination([...roles]);
}

export function canReadPrices(roles: readonly Role[]): boolean {
  return OFFICE_ROLES.some(role => roles.includes(role)) || hasWorkCoordinator(roles);
}

export function canManagePrices(roles: readonly Role[]): boolean {
  return MANAGER_ROLES.some(role => roles.includes(role)) || hasWorkCoordinator(roles);
}

// Подпись для бейджей: все роли по приоритету — «Менеджер · Инженер».
export function roleComboLabel(roles: Role[] | null | undefined): string {
  const list = roles ?? [];
  return normalizeRoles(list)
    .map((role) => roleLabels[role])
    .join(" · ");
}
