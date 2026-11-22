export const deniedMessage = "Вам не доступен этот раздел, если это ошибка - обратитесь к Администратору";

const roleAccess = {
  ADMIN: { projects: true, finance: true, warehouse: true },
  ACCOUNTANT: { finance: true },
  MANAGER: { projects: true, warehouse: true },
  PROCUREMENT: { finance: true, warehouse: true },
};

export function botUser(id, name, roles) {
  const groups = roles.map(role => roleAccess[role]);
  const projects = groups.some(group => group?.projects);
  const finance = groups.some(group => group?.finance);
  const warehouse = groups.some(group => group?.warehouse);
  return { id, name, roles, botAllowed: projects || finance || warehouse, access: { projects, finance, warehouse, deniedMessage } };
}
