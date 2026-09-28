import { createHash } from "node:crypto";
import type { ApiToken } from "@prisma/client";

export const TOKEN_PREFIX = "pero_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface VerifiedToken {
  id: string;
  name: string;
  scopes: string[];
  pluginId: string | null;
}

interface TokenStore {
  findToken: (hash: string) => Promise<ApiToken | null>;
  isOwnerActive: (id: string) => Promise<boolean>;
  recordUse: (id: string) => Promise<unknown>;
}

export function createTokenVerifier(store: TokenStore) {
  return async (authorization: string | null): Promise<VerifiedToken | null> => {
    if (!authorization?.startsWith(`Bearer ${TOKEN_PREFIX}`)) return null;
    const row = await store.findToken(hashToken(authorization.slice("Bearer ".length)));
    if (!row || row.revokedAt) return null;

    // createdById — владелец выданного из UI ключа. Ключ отсутствующего или
    // отключённого пользователя не работает даже без web-сессии. Отдельные
    // сервисные ключи без владельца управляются явным revoke в /settings/api.
    if (row.createdById && !(await store.isOwnerActive(row.createdById))) return null;

    // Только аудит best effort; проверку действительности выше не кешируем.
    void store.recordUse(row.id).catch(() => {});
    return { id: row.id, name: row.name, scopes: row.scopes, pluginId: row.pluginId };
  };
}
