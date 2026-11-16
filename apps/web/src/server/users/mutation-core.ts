import type { PayScheme, Prisma, Role, User } from "@prisma/client";
import { ADMIN_ROLES, normalizeRoles, roleCombinationError } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { apiTokenAuditSnapshot } from "@/server/plugins/mutation-core";

export interface UserSettingsInput {
  email: string; name: string; position?: string; phone?: string; telegram?: string; roles: Role[];
  payScheme: PayScheme; payPercent?: number | null; active: boolean; calendarEnabled?: boolean | null; passwordHash?: string;
}

export function userAuditSnapshot(user: Pick<User, "email" | "name" | "position" | "phone" | "telegram" | "roles" | "payScheme" | "payPercent" | "active" | "calendarEnabled" | "sessionVersion">, passwordChanged = false) {
  return { email: user.email, name: user.name, position: user.position ?? null, phone: user.phone ?? null, telegram: user.telegram ?? null,
    roles: user.roles, payScheme: user.payScheme, payPercent: user.payPercent == null ? null : String(user.payPercent), active: user.active,
    calendarEnabled: user.calendarEnabled ?? null, sessionVersion: user.sessionVersion, passwordChanged };
}

function normalized(input: UserSettingsInput) {
  const roles = normalizeRoles(input.roles), roleError = roleCombinationError(roles);
  if (roleError) throw new Error(roleError);
  return { email: input.email, name: input.name, position: input.position || null, phone: input.phone || null, telegram: input.telegram || null,
    roles, payScheme: input.payScheme, payPercent: input.payPercent ?? null, active: input.active,
    ...(input.calendarEnabled === undefined ? {} : { calendarEnabled: input.calendarEnabled }), ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}) };
}

async function auditUser(tx: Prisma.TransactionClient, actor: DomainActor, user: User, action: string, before: ReturnType<typeof userAuditSnapshot> | null, passwordChanged = false) {
  const after = userAuditSnapshot(user, passwordChanged);
  const displayBefore = before ? { ...before } : null, displayAfter = { ...after };
  // Автоматический отзыв сеансов имеет отдельное событие Системы; полный raw snapshot остаётся здесь.
  if (action === "update" && before && before.sessionVersion !== after.sessionVersion) {
    Reflect.deleteProperty(displayBefore!, "sessionVersion"); Reflect.deleteProperty(displayAfter, "sessionVersion");
  }
  return writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "user", entityId: user.id, action, oldValue: before, newValue: after }, {
    before: displayBefore, after: displayAfter, entity: { label: `Пользователь ${user.name}`, href: "/settings/users" },
  });
}

export async function createUserInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, input: UserSettingsInput & { passwordHash: string }) {
  requireActorRoles(actor, ADMIN_ROLES);
  if (await tx.user.findFirst({ where: { email: input.email }, select: { id: true } })) return { ok: false as const, error: "Email уже занят" };
  const user = await tx.user.create({ data: { ...normalized(input), passwordHash: input.passwordHash } });
  await auditUser(tx, actor, user, "create", null, true);
  return { ok: true as const, user };
}

export async function updateUserInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, userId: string, input: UserSettingsInput) {
  requireActorRoles(actor, ADMIN_ROLES);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const before = await tx.user.findUnique({ where: { id: userId } });
  if (!before) return { ok: false as const, error: "Сотрудник не найден" };
  if (await tx.user.findFirst({ where: { email: input.email, id: { not: userId } }, select: { id: true } })) return { ok: false as const, error: "Email уже занят" };
  const data = normalized(input), oldSnapshot = userAuditSnapshot(before);
  const desired = { ...oldSnapshot, ...data, payPercent: data.payPercent == null ? null : String(data.payPercent), passwordChanged: !!input.passwordHash };
  // Хэш не входит ни в сравнение пользовательских полей, ни в аудиторские данные.
  const { passwordHash: ignoredPassword, ...safeDesired } = { passwordHash: input.passwordHash, ...desired }; void ignoredPassword;
  if (!input.passwordHash && JSON.stringify(oldSnapshot) === JSON.stringify(safeDesired)) return { ok: true as const, user: before, before, noOp: true };
  const revokesTokens = before.active && !data.active || JSON.stringify(before.roles) !== JSON.stringify(data.roles);
  if (revokesTokens) await tx.$queryRaw`SELECT id FROM "ApiToken" WHERE "createdById" = ${userId} AND "revokedAt" IS NULL ORDER BY id FOR UPDATE`;
  const previousTokens = revokesTokens ? await tx.apiToken.findMany({ where: { createdById: userId, revokedAt: null }, orderBy: { id: "asc" } }) : [];
  const user = await tx.user.update({ where: { id: userId }, data });
  const parent = await auditUser(tx, actor, user, "update", oldSnapshot, !!input.passwordHash);
  const automatic = { actor: { type: "system" as const, id: "system:user-security", name: "Система" }, initiator: { id: actor.id, name: actor.name } };
  if (user.sessionVersion !== before.sessionVersion) await writeChangeLogInTransaction(tx, {
    actorType: "system", actorId: automatic.actor.id, actorName: "Система", source: actor.source,
    entity: "user", entityId: userId, action: "revokeSessions", field: "sessionVersion", oldValue: before.sessionVersion, newValue: { sessionVersion: user.sessionVersion, operationId: parent.id },
  }, { ...automatic, before: before.sessionVersion, after: user.sessionVersion, entity: { label: `Пользователь ${user.name}`, href: "/settings/users" },
    reason: "Автоматический отзыв сеансов после изменения учётной записи" });
  if (previousTokens.length) {
    const afterTokens = await tx.apiToken.findMany({ where: { id: { in: previousTokens.map(token => token.id) }, revokedAt: { not: null } }, orderBy: { id: "asc" } });
    for (const token of afterTokens) {
      const previous = previousTokens.find(row => row.id === token.id)!;
      await writeChangeLogInTransaction(tx, { actorType: "system", actorId: automatic.actor.id, actorName: "Система", source: actor.source,
        entity: "apiToken", entityId: token.id, action: "revoke", oldValue: apiTokenAuditSnapshot(previous), newValue: { ...apiTokenAuditSnapshot(token), operationId: parent.id } }, {
        ...automatic, before: apiTokenAuditSnapshot(previous), after: apiTokenAuditSnapshot(token), entity: { label: `Доступ API «${token.name}»`, href: "/settings/api" },
        reason: "Автоматический отзыв API-доступа после изменения ролей или отключения пользователя",
        links: [{ type: "user", id: userId, label: user.name, href: "/settings/users" }],
      });
    }
  }
  return { ok: true as const, user, before, noOp: false };
}

export async function revokeUserSessionsInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, userId: string) {
  requireActorRoles(actor, ADMIN_ROLES);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const before = await tx.user.findUnique({ where: { id: userId } });
  if (!before) return { ok: false as const, error: "Сотрудник не найден" };
  const user = await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  await auditUser(tx, actor, user, "revokeSessions", userAuditSnapshot(before));
  return { ok: true as const };
}
