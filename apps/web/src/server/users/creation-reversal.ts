import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "@/lib/password";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { unlinkTelegramInTransaction } from "@/server/telegram/mutation-core";
import { updateUserInTransaction } from "./mutation-core";
import { reversibleUserSettings } from "./settings-reversal-contract";

const path = "/settings/users";
const schema = z.object({ revision: z.number().int().nonnegative(), mode: z.enum(["disable", "fresh-credentials-required"]) }).strict();

async function eligible(tx: Prisma.TransactionClient, userId: string, actorId: string, data: z.infer<typeof schema>) {
  if (data.mode !== "disable") throw new JournalReversalRefusal("Повторное включение и выдача нового пароля выполняются в карточке пользователя", path);
  if (userId === actorId) throw new JournalReversalRefusal("Нельзя отключить собственную учётную запись через журнал", path);
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user?.active || user.accountRevision !== data.revision)
    throw new JournalReversalRefusal("Учётная запись отключена или изменилась после создания", path);
  if (hasAnyRole(user.roles, ADMIN_ROLES) && !await tx.user.count({ where: { id: { not: userId }, active: true, roles: { hasSome: ADMIN_ROLES } } })) {
    throw new JournalReversalRefusal("В CRM должен остаться действующий администратор", path);
  }
  const [task, project, product, percentage, timer] = await Promise.all([
    tx.task.findFirst({ where: { assigneeId: userId, status: { not: "DONE" }, project: { deletedAt: null, stage: { notIn: ["DONE", "REFUSED"] } } }, select: { id: true } }),
    tx.project.findFirst({ where: { managerId: userId, deletedAt: null, stage: { notIn: ["DONE", "REFUSED"] } }, select: { id: true } }),
    tx.product.findFirst({ where: { deletedAt: null, status: { not: "DONE" }, project: { deletedAt: null, stage: { notIn: ["DONE", "REFUSED"] } },
      OR: [{ engineerId: userId }, { assemblerId: userId }, { surveyorId: userId }, { mounterId: userId }] }, select: { id: true } }),
    tx.productPercentageParticipant.findFirst({ where: { userId, config: { product: { deletedAt: null, status: { not: "DONE" },
      project: { deletedAt: null, stage: { notIn: ["DONE", "REFUSED"] } } } } }, select: { id: true } }),
    tx.timeEntry.findFirst({ where: { userId, stoppedAt: null }, select: { id: true } }),
  ]);
  if (task || project || product || percentage || timer) throw new JournalReversalRefusal(
    "Переназначьте активные проекты, изделия, задачи и участие в процентной оплате. Остановите работающий таймер сотрудника.", path);
  return user;
}

export const userCreationReversal = defineJournalReversal({
  kind: "account.user-creation", version: 1, schema,
  confirmation: "Учётная запись будет отключена. Сеансы, пароль, API-ключи и привязка Telegram перестанут действовать.",
  async preview(ctx, data) { await eligible(ctx.tx, ctx.entityId, ctx.actor.id, data); return null; },
  async apply(ctx, data) {
    const [lock] = await ctx.tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('crm-account-admin-change', 0)) AS acquired`;
    if (!lock?.acquired) throw new JournalReversalRefusal("Учётная запись изменяется. Повторите запрос.", path);
    await ctx.tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.entityId} FOR UPDATE`;
    const user = await eligible(ctx.tx, ctx.entityId, ctx.actor.id, data);
    const settings = reversibleUserSettings(user);
    const saved = await updateUserInTransaction(ctx.tx, ctx.actor, user.id, {
      ...settings, position: settings.position ?? undefined, phone: settings.phone ?? undefined,
      telegram: settings.telegram ?? undefined, payPercent: settings.payPercent === null ? null : Number(settings.payPercent),
      passwordHash: await hashPassword(randomBytes(32).toString("base64url")), active: false,
    }, { reversal: true });
    if (!saved.ok || saved.noOp || saved.user.sessionVersion <= user.sessionVersion)
      throw new JournalReversalRefusal("Не удалось подтвердить отзыв учётных данных", path);
    const telegram = await unlinkTelegramInTransaction(ctx.tx, ctx.actor, user.id, { reversal: true });
    return {
      oldValue: { active: true }, newValue: { active: false, credentialsRevoked: true, telegramRevoked: telegram.deleted === 1 },
      hints: { reason: "Учётная запись отключена, доступ отозван. Для повторного включения нужен отдельный выпуск учётных данных." },
      inverse: { revision: saved.user.accountRevision, mode: "fresh-credentials-required" as const },
      cachePaths: ["/", path, "/settings/api"],
      afterWrite: "afterAudit" in saved ? saved.afterAudit : undefined,
    };
  },
});
