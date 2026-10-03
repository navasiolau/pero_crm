"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { requireAdmin } from "@/server/require-role";
import { writeChangeLog } from "@/server/plugins/changelog";
import { notifyPerson } from "@/server/notifications/notify";
import { paySchemeLabels } from "@/lib/labels";
import { roleComboLabel, isValidRolesCombination, normalizeRoles } from "@/lib/roles";

const ROLES = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "WORKER", "MOUNTER", "ACCOUNTANT", "PROCUREMENT"] as const;
const PAY_SCHEMES = ["PIECE", "PERCENT_PROJECT", "PERCENT_TURNOVER", "NONE"] as const;

const userSchema = z.object({
  email: z.string().email("Некорректный email"),
  name: z.string().min(1, "Укажите ФИО"),
  position: z.string().optional(),
  phone: z.string().optional(),
  telegram: z.string().optional(),
  roles: z.array(z.enum(ROLES)).min(1, "Выберите хотя бы одну роль"),
  payScheme: z.enum(PAY_SCHEMES),
  payPercent: z.number().min(0).max(100).nullable().optional(),
  active: z.boolean().default(true),
  password: z.string().optional(),
});

// Точечный отзыв всех веб-сеансов сотрудника без смены пароля/общего AUTH_SECRET.
// API-токены отзываются отдельно, отключение пользователя отзывает их в БД.
export async function revokeUserSessions(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const changed = await prisma.user.updateMany({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  if (changed.count !== 1) return { ok: false, error: "Сотрудник не найден" };
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "user",
    entityId: userId,
    action: "revokeSessions",
  });
  revalidatePath("/settings/users");
  return { ok: true };
}

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
  // Комбинированные роли (§4): нормализация + ADMIN/DIRECTOR не сочетаются
  const roles = normalizeRoles(data.roles);
  if (!isValidRolesCombination(roles)) {
    return {
      ok: false,
      error: "Роли «Администратор» и «Директор» не сочетаются с другими ролями",
    };
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
      roles,
      payScheme: data.payScheme,
      payPercent: data.payPercent ?? null,
      active: data.active,
      passwordHash: await hashPassword(data.password),
    },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "user",
    entityId: user.id,
    action: "create",
    newValue: { email: user.email, name: user.name, roles: user.roles },
  });
  // Уведомление человеку о создании его учётной записи (§6.1)
  await notifyPerson({
    userId: user.id,
    type: "user.accountChanged",
    title: "Для вас создана учётная запись",
    body: `Роли: ${roleComboLabel(user.roles)} · схема оплаты: ${paySchemeLabels[user.payScheme] ?? user.payScheme}`,
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

  // Комбинированные роли (§4): нормализация + ADMIN/DIRECTOR не сочетаются
  const roles = normalizeRoles(data.roles);
  if (!isValidRolesCombination(roles)) {
    return {
      ok: false,
      error: "Роли «Администратор» и «Директор» не сочетаются с другими ролями",
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      email: data.email,
      name: data.name,
      position: data.position || null,
      phone: data.phone || null,
      telegram: data.telegram || null,
      roles,
      payScheme: data.payScheme,
      payPercent: data.payPercent ?? null,
      active: data.active,
      ...(data.password
        ? { passwordHash: await hashPassword(data.password) }
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
      roles: before.roles,
      active: before.active,
    },
    newValue: {
      email: data.email,
      name: data.name,
      roles: data.roles,
      active: data.active,
      passwordChanged: !!data.password,
    },
  });

  // Уведомление человеку об изменениях его учётной записи (§6.1) —
  // всё, КРОМЕ пароля (и его собственных настроек, которые меняет он сам).
  const changes: string[] = [];
  if (before.name !== data.name) changes.push(`ФИО: ${before.name} → ${data.name}`);
  if (before.email !== data.email) changes.push(`Email: ${before.email} → ${data.email}`);
  if (before.roles.join(",") !== data.roles.join(","))
    changes.push(`Роли: ${roleComboLabel(before.roles)} → ${roleComboLabel(roles)}`);
  if (before.payScheme !== data.payScheme)
    changes.push(
      `Схема оплаты: ${paySchemeLabels[before.payScheme] ?? before.payScheme} → ${paySchemeLabels[data.payScheme] ?? data.payScheme}`,
    );
  if (Number(before.payPercent ?? 0) !== (data.payPercent ?? 0))
    changes.push(`Процент: ${before.payPercent ?? 0}% → ${data.payPercent ?? 0}%`);
  if ((before.position ?? "") !== (data.position ?? ""))
    changes.push(`Должность: ${before.position ?? "—"} → ${data.position || "—"}`);
  if ((before.phone ?? "") !== (data.phone ?? "")) changes.push("Телефон изменён");
  if ((before.telegram ?? "") !== (data.telegram ?? "")) changes.push("Telegram изменён");
  if (before.active !== data.active)
    changes.push(data.active ? "Учётная запись активирована" : "Учётная запись деактивирована");
  if (changes.length > 0) {
    await notifyPerson({
      userId,
      type: "user.accountChanged",
      title: "Изменена ваша учётная запись",
      body: changes.join(" · "),
    });
  }

  revalidatePath("/settings/users");
  return { ok: true };
}
