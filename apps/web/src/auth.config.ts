import type { NextAuthConfig } from "next-auth";

// Edge-safe конфигурация Auth.js: без prisma/bcrypt (они подключаются в auth.ts).
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
      const adminOnlyPrefixes = ["/finance", "/changelog", "/settings"];
      const isAdminOnly = adminOnlyPrefixes.some((prefix) =>
        pathname.startsWith(prefix),
      );
      if (
        isAdminOnly &&
        auth.user.role !== "ADMIN" &&
        auth.user.role !== "DIRECTOR"
      ) {
        return Response.redirect(new URL("/", request.nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
