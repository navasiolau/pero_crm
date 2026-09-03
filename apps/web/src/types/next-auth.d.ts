import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: Role[];
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    roles: Role[];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    roles: Role[];
    // Наследие одноролевой модели: живые JWT после деплоя обновляются
    // с фолбэком на это поле (см. session-callback в auth.config.ts)
    role?: Role;
  }
}
