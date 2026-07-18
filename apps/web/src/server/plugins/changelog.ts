import { prisma } from "@/lib/prisma";

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
  return prisma.changeLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId,
      actorName: entry.actorName,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      field: entry.field,
      oldValue: entry.oldValue === undefined ? undefined : JSON.parse(JSON.stringify(entry.oldValue)),
      newValue: entry.newValue === undefined ? undefined : JSON.parse(JSON.stringify(entry.newValue)),
      source: entry.source ?? "web",
    },
  });
}
