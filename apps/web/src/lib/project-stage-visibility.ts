import type { Role } from "@prisma/client";
import { ENGINEER_PROJECT_STAGES } from "./engineering-read-access";
import { FIELD_ROLES, MANAGER_ROLES } from "./roles";
import { STAGES } from "./stages";

/** Производственный grant может открыть проект любого этапа через изделие/задачу. */
export function visibleProjectStages(roles: readonly Role[]) {
  if (roles.includes("PROCUREMENT") || [...MANAGER_ROLES, ...FIELD_ROLES].some(role => roles.includes(role))) return STAGES;
  return roles.includes("ENGINEER")
    ? STAGES.filter(stage => ENGINEER_PROJECT_STAGES.some(id => id === stage.id))
    : [];
}
