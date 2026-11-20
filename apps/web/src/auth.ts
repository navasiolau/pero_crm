import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomUUID } from "node:crypto";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { authenticateCrmCredentials } from "@/server/auth/credentials";
import { createSessionCallbacks } from "@/server/auth/session-callbacks";
import { createJournalAuthEvents, markJournalSignIn } from "@/server/auth/journal-events";

const sessionCallbacks = createSessionCallbacks((id) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, roles: true, active: true, sessionVersion: true } }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  events: createJournalAuthEvents(prisma),
  callbacks: {
    ...authConfig.callbacks,
    ...sessionCallbacks,
    async jwt(input) {
      if (input.user) markJournalSignIn(input.user, false);
      const token = await sessionCallbacks.jwt(input);
      if (input.user && token !== null) markJournalSignIn(input.user, true);
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      authorize: async (credentials) => {
        const user = await authenticateCrmCredentials(credentials);
        return user ? { ...user, auditLoginId: randomUUID() } : null;
      },
    }),
  ],
});
