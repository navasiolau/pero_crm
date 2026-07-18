import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

const TOKEN_PREFIX = "pero_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

export interface VerifiedToken {
  id: string;
  name: string;
  scopes: string[];
  pluginId: string | null;
}

export async function verifyApiToken(
  authorization: string | null,
): Promise<VerifiedToken | null> {
  if (!authorization?.startsWith(`Bearer ${TOKEN_PREFIX}`)) return null;
  const tokenHash = hashToken(authorization.slice("Bearer ".length));
  const row = await prisma.apiToken.findUnique({ where: { tokenHash } });
  if (!row || row.revokedAt) return null;
  // lastUsedAt — best effort, не блокируем запрос
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { id: row.id, name: row.name, scopes: row.scopes, pluginId: row.pluginId };
}

export function hasScope(token: VerifiedToken, scope: string): boolean {
  return token.scopes.includes(scope) || token.scopes.includes("admin");
}
