import type { Prisma, Role } from "@prisma/client";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import type { KpApiScope } from "@/lib/kp-api-scopes";
import type { VerifiedToken } from "@/server/plugins/token-verification";
import { apiFailure, type KpApiContext, type KpActorBinding } from "./api-contract";

export type KpAuthUser = { id: string; name: string; active: boolean; roles: Role[]; sessionVersion: number };
export type KpAuthToken = { id: string; createdById: string | null; scopes: string[]; revokedAt: Date | null };
export type KpAuthStore = {
  user(id: string, tx?: Prisma.TransactionClient): Promise<KpAuthUser | null>;
  token(id: string, tx?: Prisma.TransactionClient): Promise<KpAuthToken | null>;
};
export function createKpBindingAuthorizer(store: KpAuthStore) {
  return async (binding: KpActorBinding, scope: KpApiScope, tx?: Prisma.TransactionClient) => {
    if (binding.source === "api") {
      if (!binding.tokenId) return apiFailure("KP_AUTH_REQUIRED", 401, "Нужен действующий ключ КП");
      const token = await store.token(binding.tokenId, tx);
      if (!token || token.revokedAt || !token.createdById || token.createdById !== binding.id)
        return apiFailure("KP_AUTH_REQUIRED", 401, "Ключ КП отозван или не привязан к владельцу");
      // Общие admin/read/write не открывают новый набор данных КП.
      if (!token.scopes.includes(scope)) return apiFailure("KP_SCOPE_REQUIRED", 403, `Нужен scope ${scope}`);
    } else if (binding.source !== "web" || !Number.isSafeInteger(binding.sessionVersion) || (binding.sessionVersion ?? -1) < 0) {
      return apiFailure("KP_AUTH_REQUIRED", 401, "Войдите в CRM заново");
    }
    const user = await store.user(binding.id, tx);
    if (!user?.active || binding.source === "web" && user.sessionVersion !== binding.sessionVersion)
      return apiFailure("KP_AUTH_REQUIRED", 401, "Сессия или владелец ключа недействительны");
    if (!hasAnyRole(user.roles, MANAGER_ROLES)) return apiFailure("KP_FORBIDDEN", 403, "КП доступны руководству и менеджерам");
    return { id: user.id, name: user.name, roles: user.roles, source: binding.source };
  };
}

export function assertKpOrigin(request: Request, configuredOrigin?: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  try {
    const expected = new URL(configuredOrigin ?? request.url);
    const actual = origin ? new URL(origin) : null;
    if (!actual || !["http:", "https:"].includes(expected.protocol) || actual.origin !== expected.origin ||
      actual.username || actual.password || actual.pathname !== "/" || actual.search || actual.hash ||
      request.headers.get("sec-fetch-site") === "cross-site") throw Error("origin");
  } catch { apiFailure("KP_ORIGIN_REQUIRED", 403, "Изменения КП доступны только из этого сайта CRM"); }
}

export function createKpRequestAuthorizer(dependencies: {
  store: KpAuthStore;
  verify(authorization: string | null): Promise<VerifiedToken | null>;
  session(): Promise<{ user?: { id?: string; sessionVersion?: number } } | null>;
  configuredOrigin?: string;
}) {
  const authorizeBinding = createKpBindingAuthorizer(dependencies.store);
  return async (request: Request, surface: "session" | "bearer", required: KpApiScope | readonly KpApiScope[]): Promise<KpApiContext> => {
    const scopes = typeof required === "string" ? [required] : required;
    let scope = scopes[0];
    if (!scope) return apiFailure("KP_SCOPE_REQUIRED", 403, "Не задано право КП");
    let binding: KpActorBinding;
    if (surface === "bearer") {
      const header = request.headers.get("authorization");
      const verified = header && header.length <= 512 ? await dependencies.verify(header) : null;
      if (!verified) return apiFailure("KP_AUTH_REQUIRED", 401, "Нужен действительный Bearer-ключ КП");
      const token = await dependencies.store.token(verified.id);
      if (!token?.createdById) return apiFailure("KP_AUTH_REQUIRED", 401, "Ключ КП должен иметь владельца");
      scope = scopes.find(value => token.scopes.includes(value)) ?? scope;
      binding = { id: token.createdById, source: "api", tokenId: token.id };
    } else {
      const session = await dependencies.session();
      if (!session?.user?.id) return apiFailure("KP_AUTH_REQUIRED", 401, "Войдите в CRM");
      binding = { id: session.user.id, source: "web", sessionVersion: session.user.sessionVersion };
    }
    const actor = await authorizeBinding(binding, scope);
    if (surface === "session") assertKpOrigin(request, dependencies.configuredOrigin);
    return { actor, binding, authorize: (nextScope = scope, tx) => authorizeBinding(binding, nextScope, tx) };
  };
}
