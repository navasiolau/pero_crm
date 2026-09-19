import type { NextAuthConfig } from "next-auth";

import { ADMIN_ROLES, FINANCE_ROLES, hasAnyRole } from "@/lib/roles";

// Edge-safe конфигурация Auth.js: без prisma/argon2 (они подключаются в auth.ts).
// Используется и middleware, и основным экземпляром NextAuth.
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
      // Финансы — админ/директор/бухгалтер; журнал и настройки — только админ/директор
      if (pathname.startsWith("/finance") && !hasAnyRole(roles, FINANCE_ROLES)) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      const adminOnlyPrefixes = ["/changelog", "/settings"];
      const isAdminOnly = adminOnlyPrefixes.some((prefix) =>
        pathname.startsWith(prefix),
      );
      if (isAdminOnly && !hasAnyRole(roles, ADMIN_ROLES)) {
        return Response.redirect(new URL("/", request.nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.roles = user.roles;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        // Фолбэк для живых JWT, выданных до перехода на роли[] (после деплоя
        // пользователи не разлогиниваются; при следующем входе — новый формат)
        session.user.roles = token.roles ?? (token.role ? [token.role] : []);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
