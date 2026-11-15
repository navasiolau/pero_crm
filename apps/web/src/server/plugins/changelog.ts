import { prisma } from "@/lib/prisma";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";

export interface ChangeLogInput {
  actorType: "user" | "plugin" | "system";
  actorId: string; // userId | plugin:<id> | system
  actorName?: string;
  entity: string;
  entityId: string;
  action: string; // create | update | delete | toggle | command | ...
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  source?: "web" | "telegram" | "plugin" | "api";
}

// Журнал изменений (§5): кто, что, когда, было → стало, источник.
// Пишется из server actions, команд плагинов и REST API.
export async function writeChangeLog(entry: ChangeLogInput) {
  return writeChangeLogInTransaction(prisma, entry);
}
