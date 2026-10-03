import type { NextAuthConfig } from "next-auth";

import { ADVANCE_ROLES, FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import { homePathForRoles } from "@/lib/home-route";
import { canAccessSettingsPath } from "@/lib/settings-access";
import {canAccessOperationalPath} from '@/lib/operational-access';

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
      if (roles.length === 0) return false;
      const homePath = homePathForRoles(roles);
      if(!canAccessOperationalPath(roles,pathname))return Response.redirect(new URL(homePath,request.nextUrl));
      if (pathname === "/" && homePath !== "/") {
        return Response.redirect(new URL(homePath, request.nextUrl));
      }
      // Финансы и настройки сохраняют свои grants; глобальный журнал — ADMIN only.
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
      if (isAdminOnly && !hasAnyRole(roles, ["ADMIN"])) {
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
