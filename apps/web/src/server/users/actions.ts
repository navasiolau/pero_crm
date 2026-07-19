"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/require-role";
import { writeChangeLog } from "@/server/plugins/changelog";

const ROLES = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as const;
const PAY_SCHEMES = ["PIECE", "PERCENT_PROJECT", "PERCENT_TURNOVER", "NONE"] as const;

const userSchema = z.object({
  email: z.string().email("Некорректный email"),
  name: z.string().min(1, "Укажите ФИО"),
  position: z.string().optional(),
  phone: z.string().optional(),
  telegram: z.string().optional(),
  role: z.enum(ROLES),
  payScheme: z.enum(PAY_SCHEMES),
  payPercent: z.number().min(0).max(100).nullable().optional(),
  active: z.boolean().default(true),
  password: z.string().optional(),
});

// Создание сотрудника (админ/директор, §4).
export async function createUser(
  input: z.input<typeof userSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  if (!data.password || data.password.length < 8) {
    return { ok: false, error: "Пароль — минимум 8 символов" };
  }
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) return { ok: false, error: "Email уже занят" };

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      position: data.position || null,
      phone: data.phone || null,
      telegram: data.telegram || null,
      role: data.role,
      payScheme: data.payScheme,
      payPercent: data.payPercent ?? null,
      active: data.active,
      passwordHash: await bcrypt.hash(data.password, 10),
    },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "user",
    entityId: user.id,
    action: "create",
    newValue: { email: user.email, name: user.name, role: user.role },
  });
  revalidatePath("/settings/users");
  return { ok: true };
}

// Редактирование сотрудника. Пароль меняется, только если задан новый.
export async function updateUser(
  userId: string,
  input: z.input<typeof userSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) return { ok: false, error: "Сотрудник не найден" };
  if (data.password && data.password.length > 0 && data.password.length < 8) {
    return { ok: false, error: "Пароль — минимум 8 символов" };
  }
  const emailTaken = await prisma.user.findFirst({
    where: { email: data.email, id: { not: userId } },
  });
  if (emailTaken) return { ok: false, error: "Email уже занят" };

  await prisma.user.update({
    where: { id: userId },
    data: {
      email: data.email,
      name: data.name,
      position: data.position || null,
      phone: data.phone || null,
      telegram: data.telegram || null,
      role: data.role,
      payScheme: data.payScheme,
      payPercent: data.payPercent ?? null,
      active: data.active,
      ...(data.password
        ? { passwordHash: await bcrypt.hash(data.password, 10) }
        : {}),
    },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "user",
    entityId: userId,
    action: "update",
    oldValue: {
      email: before.email,
      name: before.name,
      role: before.role,
      active: before.active,
    },
    newValue: {
      email: data.email,
      name: data.name,
      role: data.role,
      active: data.active,
      passwordChanged: !!data.password,
    },
  });
  revalidatePath("/settings/users");
  return { ok: true };
}
