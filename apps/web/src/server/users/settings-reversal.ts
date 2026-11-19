import type { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { updateUserInTransaction } from "./mutation-core";
import { reversibleUserSettings, userSettingsChange } from "./settings-reversal-contract";

async function load(tx: Prisma.TransactionClient, userId: string, data: z.infer<typeof userSettingsChange>) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.accountRevision !== data.revision || JSON.stringify(reversibleUserSettings(user)) !== JSON.stringify(data.after))
    throw new JournalReversalRefusal("Настройки изменились после записи", "/settings/users");
  if (hasAnyRole(user.roles, ADMIN_ROLES) && user.active && (!data.before.active || !hasAnyRole(data.before.roles, ADMIN_ROLES))) {
    const remaining = await tx.user.count({ where: { active: true, id: { not: userId }, roles: { hasSome: ADMIN_ROLES } } });
    if (!remaining) throw new JournalReversalRefusal("Должна остаться действующая учётная запись администратора", "/settings/users");
  }
  return user;
}

export const userSettingsReversal = defineJournalReversal({
  kind: "account.settings", version: 1, schema: userSettingsChange,
  async preview(ctx, data) { await load(ctx.tx, ctx.entityId, data); return null; },
  async apply(ctx, data) {
    await ctx.tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('crm-account-admin-change', 0))`;
    await ctx.tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.entityId} FOR UPDATE`;
    await load(ctx.tx, ctx.entityId, data);
    const desired = data.before;
    const saved = await updateUserInTransaction(ctx.tx, ctx.actor, ctx.entityId, {
      ...desired, position: desired.position ?? undefined, phone: desired.phone ?? undefined,
      telegram: desired.telegram ?? undefined, payPercent: desired.payPercent === null ? null : Number(desired.payPercent),
    }, { reversal: true });
    if (!saved.ok || saved.noOp) throw new JournalReversalRefusal(saved.ok ? "Настройки уже совпадают" : saved.error, "/settings/users");
    const after = reversibleUserSettings(saved.user);
    return {
      oldValue: data.after, newValue: after, inverse: { before: data.after, after, revision: saved.user.accountRevision },
      cachePaths: ["/", "/settings/users"],
      afterWrite: "afterAudit" in saved ? saved.afterAudit : undefined,
    };
  },
});
