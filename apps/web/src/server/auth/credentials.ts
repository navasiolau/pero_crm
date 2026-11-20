import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const schema = z.object({ email: z.email(), password: z.string().min(1) });

/** Общая проверка пароля CRM, без выдачи cookie или JWT вызывающей стороне. */
export async function authenticateCrmCredentials(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, select: {
    id: true, email: true, name: true, roles: true, active: true, sessionVersion: true, passwordHash: true,
  } });
  if (!user?.active || !await verifyPassword(user.passwordHash, password)) return null;
  return { id: user.id, email: user.email, name: user.name, roles: user.roles, sessionVersion: user.sessionVersion };
}
