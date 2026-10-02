import type { NextAuthConfig } from "next-auth";

import { ADMIN_ROLES, ADVANCE_ROLES, FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import { homePathForRoles } from "@/lib/home-route";
import { canAccessSettingsPath } from "@/lib/settings-access";

// Общие route/session callbacks. Единственный экземпляр Auth.js в auth.ts
// добавляет обязательную проверку актуального пользователя из БД.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  // Self-hosted (Docker/Caddy, локальный prod): доверяем хосту из запроса
  trustHost: true,
  providers: [], // провайдеры добавляются в auth.ts
  callbacks: {
    authorized({ auth, request }) {
      if (!auth?.user) {
        // Неавторизованных — на страницу входа
        return false;
      }

      const { pathname } = request.nextUrl;
      const roles = auth.user.roles ?? [];
      const homePath = homePathForRoles(roles);
      if (pathname === "/" && homePath !== "/") {
        return Response.redirect(new URL(homePath, request.nextUrl));
      }
      // Финансы — админ/директор/бухгалтер; журнал и настройки — только админ/директор
      if (pathname.startsWith("/finance") && !hasAnyRole(roles, FINANCE_ROLES)) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      if (pathname.startsWith("/advances") && !hasAnyRole(roles, ADVANCE_ROLES)) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      if (pathname.startsWith("/settings") && !canAccessSettingsPath(roles, pathname)) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      const adminOnlyPrefixes = ["/changelog"];
      const isAdminOnly = adminOnlyPrefixes.some((prefix) =>
        pathname.startsWith(prefix),
      );
      if (isAdminOnly && !hasAnyRole(roles, ADMIN_ROLES)) {
        return Response.redirect(new URL("/", request.nextUrl));
      }

      return true;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.roles = token.roles;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
