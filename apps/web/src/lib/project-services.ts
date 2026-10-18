import { decimalAtoms, decimalText, type ProjectServices } from "./product-quantity";

export const PROJECT_SERVICE_FIELDS = ["servicesTotal", "delivery", "unloading", "installation"] as const;
export type ProjectServiceField = typeof PROJECT_SERVICE_FIELDS[number];
export type ProjectServiceSnapshot = Record<ProjectServiceField, string | null>;
export function projectServiceSnapshot(project: ProjectServices): ProjectServiceSnapshot {
  const value = (field: ProjectServiceField) => project[field] === null || project[field] === undefined ? null : decimalText(decimalAtoms(project[field]!, 2, 12), 2);
  return { servicesTotal: value("servicesTotal"), delivery: value("delivery"), unloading: value("unloading"), installation: value("installation") };
}
export function isProjectServiceField(field: string): field is ProjectServiceField {
  return (PROJECT_SERVICE_FIELDS as readonly string[]).includes(field);
}
export class ProjectServicesConflict extends Error {
  constructor() { super("Услуги изменены другим пользователем — обновите исходные суммы"); }
}

/** Для переключения режима требуется полный CAS-снимок; альтернативы очищаются одной записью. */
export function projectServicePatch(current: ProjectServiceSnapshot, field: ProjectServiceField, value: string | null,
  expected?: ProjectServiceSnapshot): Partial<ProjectServiceSnapshot> {
  const toTotal = field === "servicesTotal" && value !== null;
  const switchMode = toTotal ? current.servicesTotal === null : field !== "servicesTotal" && current.servicesTotal !== null;
  const same = (a: string | null, b: string | null) => a === null || b === null ? a === b : decimalAtoms(a, 2, 12) === decimalAtoms(b, 2, 12);
  if ((switchMode && !expected) || (expected && PROJECT_SERVICE_FIELDS.some(key => !same(current[key], expected[key])))) throw new ProjectServicesConflict();
  if (toTotal) return { servicesTotal: value, delivery: null, unloading: null, installation: null };
  return { [field]: value, ...(field !== "servicesTotal" ? { servicesTotal: null } : {}) };
}
