import type { Role } from "@prisma/client";

export type { Role };

// ─── Комбинированные роли (§4) ────────────────────────────────────────────────
// У сотрудника массив ролей User.roles; права = ОБЪЕДИНЕНИЕ прав всех ролей
// («разрешено, если есть хоть одна подходящая роль» — см. hasAnyRole).
// Отдельные негативные правила и отображение опираются на ПРИОРИТЕТ: старшая
// роль побеждает. ADMIN и DIRECTOR не комбинируются ни с чем (решение
// владельца) — их привилегии особые, «половинчатый» админ недопустим.

// Лестница приоритета: от старшей к младшей.
export const ROLE_PRIORITY: Role[] = [
  "ADMIN",
  "DIRECTOR",
  "MANAGER",
  "ENGINEER",
  "ACCOUNTANT",
  "WORKER",
  "MOUNTER",
];

export const roleLabels: Record<Role, string> = {
  ADMIN: "Администратор",
  DIRECTOR: "Директор",
  MANAGER: "Менеджер",
  ENGINEER: "Инженер",
  WORKER: "Работник",
  MOUNTER: "Монтажник",
  ACCOUNTANT: "Бухгалтер",
};

// Ролевые наборы — единый источник истины (вместо инлайн-массивов по коду).
// Офисные роли: полный просмотр проектов/изделий/клиентов.
export const OFFICE_ROLES: Role[] = [
  "ADMIN",
  "DIRECTOR",
  "MANAGER",
  "ENGINEER",
  "ACCOUNTANT",
];
// Менеджмент: создание/правка проектов, задач, изделий, работ.
export const MANAGER_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER"];
// Финансы: выплаты, приходы/расходы, кассы, статьи (§10–§11).
export const FINANCE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "ACCOUNTANT"];
// Настройки и журнал изменений.
export const ADMIN_ROLES: Role[] = ["ADMIN", "DIRECTOR"];
// Производственный персонал: без дашборда, время — только таймером.
export const FIELD_ROLES: Role[] = ["WORKER", "MOUNTER"];
// Кому можно назначать задачи/работы (исполнители).
export const ASSIGNEE_ROLES: Role[] = [...ROLE_PRIORITY];

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
  return ROLE_PRIORITY.find((role) => userRoles?.includes(role)) ?? "WORKER";
}

// Дедупликация + канонический порядок по приоритету.
export function normalizeRoles(roles: Role[]): Role[] {
  return ROLE_PRIORITY.filter((role) => roles.includes(role));
}

// Валидация комбинации: минимум одна роль; ADMIN и DIRECTOR — только поодиночке.
export function isValidRolesCombination(roles: Role[]): boolean {
  const normalized = normalizeRoles(roles);
  if (normalized.length === 0) return false;
  const exclusive = normalized.some((role) => role === "ADMIN" || role === "DIRECTOR");
  return exclusive ? normalized.length === 1 : true;
}

// Подпись для бейджей: все роли по приоритету — «Менеджер · Инженер».
export function roleComboLabel(roles: Role[] | null | undefined): string {
  const list = roles ?? [];
  return normalizeRoles(list)
    .map((role) => roleLabels[role])
    .join(" · ");
}
