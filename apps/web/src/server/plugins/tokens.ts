import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

import {
  createTokenVerifier,
  hashToken,
  TOKEN_PREFIX,
  type VerifiedToken,
} from "./token-verification";

export type { VerifiedToken } from "./token-verification";

// Токены публичного REST API (/api/v1). Храним только sha256-хэш;
// сам токен показывается один раз при создании.
export async function createApiToken(input: {
  name: string;
  scopes: string[];
  pluginId?: string;
  createdById?: string;
}): Promise<{ token: string; id: string }> {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const row = await prisma.apiToken.create({
    data: {
      name: input.name,
      prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      tokenHash: hashToken(token),
      scopes: input.scopes,
      pluginId: input.pluginId,
      createdById: input.createdById,
    },
  });
  return { token, id: row.id };
}

export const verifyApiToken = createTokenVerifier({
  findToken: (tokenHash) => prisma.apiToken.findUnique({ where: { tokenHash } }),
  isOwnerActive: async (id) => {
    const owner = await prisma.user.findUnique({ where: { id }, select: { active: true } });
    return owner?.active === true;
  },
  recordUse: (id) => prisma.apiToken.update({ where: { id }, data: { lastUsedAt: new Date() } }),
});

export function hasScope(token: VerifiedToken, scope: string): boolean {
  return token.scopes.includes(scope) || token.scopes.includes("admin");
}
