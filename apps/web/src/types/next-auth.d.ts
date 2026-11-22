import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: Role[];
      sessionVersion?: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    roles: Role[];
    sessionVersion: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    roles: Role[];
    // Отсутствие версии в старом JWT означает обязательный новый вход.
    sessionVersion?: number;
  }
}
