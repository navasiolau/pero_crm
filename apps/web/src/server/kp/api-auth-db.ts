import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createKpBindingAuthorizer, type KpAuthStore } from "./api-auth";
import type { DomainActor } from "@/server/actor";
import { apiFailure } from "./api-contract";

export const kpAuthStore: KpAuthStore = {
  async user(id, tx) {
    if (tx) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR SHARE`;
    return (tx ?? prisma).user.findUnique({ where: { id }, select: { id: true, name: true, active: true, roles: true, sessionVersion: true } });
  },
  async token(id, tx) {
    if (tx) await tx.$queryRaw`SELECT id FROM "ApiToken" WHERE id = ${id} FOR SHARE`;
    return (tx ?? prisma).apiToken.findUnique({ where: { id }, select: { id: true, createdById: true, scopes: true, revokedAt: true } });
  },
};
export const authorizeKpBinding = createKpBindingAuthorizer(kpAuthStore);
export const lifecycleSecurity = (scope: Parameters<typeof authorizeKpBinding>[1]) => ({
  authorizeSource: async (tx: Prisma.TransactionClient, binding: { id: string; source: DomainActor["source"]; tokenId?: string; sessionVersion?: number }) => {
    if (binding.source !== "api" && binding.source !== "web") return apiFailure("KP_AUTH_REQUIRED", 401, "Нужен ключ КП или сессия CRM");
    await authorizeKpBinding({ ...binding, source: binding.source }, scope, tx);
  },
});
