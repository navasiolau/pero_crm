import type { Prisma } from "@prisma/client";
import type { AuditEntry, PluginReadDatabase } from "@pero/plugin-sdk";
import { liveProjectWhere } from "@/server/access/live-entities";

const projectFields = { id: true, number: true, title: true } as const;

export function pluginReadDatabase(connection: Pick<Prisma.TransactionClient, "project">, permissions: readonly string[]): PluginReadDatabase {
  if (!permissions.includes("projects:read")) return Object.freeze({});
  return Object.freeze({
    project: Object.freeze({
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (typeof where?.id !== "string" || !where.id || where.id.length > 128) return null;
        return connection.project.findFirst({ where: { ...liveProjectWhere, id: where.id }, select: projectFields });
      },
      findMany: (input?: { take?: number }) =>
        connection.project.findMany({
          where: liveProjectWhere, select: projectFields, orderBy: { id: "asc" },
          take: Number.isSafeInteger(input?.take) ? Math.max(1, Math.min(100, input?.take ?? 20)) : 20,
        }),
    }),
  });
}

export function assertPluginAuditEntry(pluginId: string, entry: AuditEntry) {
  if (entry.entity !== "plugin" || entry.entityId !== pluginId) throw Error("PLUGIN_AUDIT_SCOPE");
}

export function assertPluginEventType(pluginId: string, type: string) {
  const namespace = `plugin.${pluginId}.`;
  if (!(type.startsWith(namespace) || (pluginId === "demo" && type === "demo.ping")) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(type)) throw Error("PLUGIN_EVENT_SCOPE");
}
