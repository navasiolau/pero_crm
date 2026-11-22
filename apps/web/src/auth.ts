import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { authenticateCrmCredentials } from "@/server/auth/credentials";
import { createSessionCallbacks } from "@/server/auth/session-callbacks";

const sessionCallbacks = createSessionCallbacks((id) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, roles: true, active: true, sessionVersion: true } }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    ...sessionCallbacks,
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      authorize: authenticateCrmCredentials,
    }),
  ],
});
