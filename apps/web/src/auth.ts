import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSessionCallbacks } from "@/server/auth/session-callbacks";
import { createJournalAuthEvents, markJournalSignIn } from "@/server/auth/journal-events";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

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
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;

        const passwordMatches = await verifyPassword(
          user.passwordHash,
          password,
        );
        if (!passwordMatches) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          sessionVersion: user.sessionVersion,
          auditLoginId: randomUUID(),
        };
      },
    }),
  ],
});
