import type { User } from "@prisma/client";
import type { NextAuthConfig } from "next-auth";

export type SessionUser = Pick<
  User,
  "id" | "name" | "email" | "roles" | "active" | "sessionVersion"
>;

type FindSessionUser = (id: string) => Promise<SessionUser | null>;

// Этот callback используется ОДНИМ экземпляром Auth.js: middleware (Node),
// auth(), /api/auth/session. Нельзя доверять ролям из ранее выданного JWT.
export function createSessionCallbacks(findUser: FindSessionUser) {
  return {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion;
      }

      // Старые JWT без версии требуют нового входа после первого deployment.
      // trigger=update/session от браузера не может обновить/повысить эту версию.
      if (
        typeof token.id !== "string" ||
        !Number.isSafeInteger(token.sessionVersion) ||
        (token.sessionVersion ?? -1) < 0
      ) {
        return null;
      }

      // Без кеша: отзыв должен действовать на следующий запрос. При ошибке БД
      // Auth.js завершает проверку отказом, а не возвращает старые полномочия.
      const current = await findUser(token.id);
      if (
        !current?.active ||
        current.sessionVersion !== token.sessionVersion
      ) {
        return null;
      }

      return {
        ...token,
        id: current.id,
        name: current.name,
        email: current.email,
        roles: current.roles,
      };
    },
  } satisfies NonNullable<NextAuthConfig["callbacks"]>;
}
