"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { requireAdmin } from "@/server/require-role";
import { createUserInTransaction, updateUserInTransaction, revokeUserSessionsInTransaction } from "./mutation-core";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { notifyPerson } from "@/server/notifications/notify";
import { paySchemeLabels } from "@/lib/labels";
import { ROLE_VALUES, roleComboLabel, roleCombinationError, normalizeRoles } from "@/lib/roles";

const PAY_SCHEMES = ["PIECE", "PERCENT_PROJECT", "PERCENT_TURNOVER", "NONE"] as const;

const userSchema = z.object({
  email: z.string().email("Некорректный email"),
  name: z.string().min(1, "Укажите ФИО"),
  position: z.string().optional(),
  phone: z.string().optional(),
  telegram: z.string().optional(),
  roles: z.array(z.enum(ROLE_VALUES)).min(1, "Выберите хотя бы одну роль"),
  payScheme: z.enum(PAY_SCHEMES),
  payPercent: z.number().min(0).max(100).nullable().optional(),
  active: z.boolean().default(true),
  password: z.string().optional(),
  calendarEnabled: z.boolean().nullable().optional(),
});

// Точечный отзыв всех веб-сеансов сотрудника без смены пароля/общего AUTH_SECRET.
// API-токены отзываются отдельно, отключение пользователя отзывает их в БД.
export async function revokeUserSessions(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const result = await prisma.$transaction(tx => revokeUserSessionsInTransaction(tx, {
    id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web",
  }, userId));
  if (!result.ok) return result;
  await deliverPostCommit("user-update", userId, [{ kind: "cache", run: () => { revalidatePath("/", "layout"); revalidatePath("/settings/users"); } }]);
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
  const roleError = roleCombinationError(roles);
  if (roleError) {
    return {
      ok: false,
      error: roleError,
    };
  }
  const passwordHash = await hashPassword(data.password);
  const created = await prisma.$transaction(tx => createUserInTransaction(tx, {
    id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web",
  }, { ...data, roles, passwordHash }));
  if (!created.ok) return created;
  const user = created.user;
  // Уведомление человеку о создании его учётной записи (§6.1)
  await deliverPostCommit("user-create", user.id, [{ kind: "person", run: () => notifyPerson({
    userId: user.id,
    type: "user.accountChanged",
    title: "Для вас создана учётная запись",
    body: `Роли: ${roleComboLabel(user.roles)} · схема оплаты: ${paySchemeLabels[user.payScheme] ?? user.payScheme}`,
  }) }, { kind: "cache", run: () => { revalidatePath("/", "layout"); revalidatePath("/settings/users"); } }]);
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
  if (data.password && data.password.length > 0 && data.password.length < 8) {
    return { ok: false, error: "Пароль — минимум 8 символов" };
  }

  // Комбинированные роли (§4): нормализация + ADMIN/DIRECTOR не сочетаются
  const roles = normalizeRoles(data.roles);
  const roleError = roleCombinationError(roles);
  if (roleError) {
    return {
      ok: false,
      error: roleError,
    };
  }

  const passwordHash = data.password ? await hashPassword(data.password) : undefined;
  const saved = await prisma.$transaction(tx => updateUserInTransaction(tx, {
    id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web",
  }, userId, { ...data, roles, passwordHash }));
  if (!saved.ok) return saved;
  if (saved.noOp) return { ok: true };
  const before = saved.before;

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
    await deliverPostCommit("user-update", userId, [{ kind: "person", run: () => notifyPerson({
      userId,
      type: "user.accountChanged",
      title: "Изменена ваша учётная запись",
      body: changes.join(" · "),
    }) }]);
  }

  await deliverPostCommit("user-update", userId, [{ kind: "cache", run: () => { revalidatePath("/", "layout"); revalidatePath("/settings/users"); } }]);
  return { ok: true };
}
