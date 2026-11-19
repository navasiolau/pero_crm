import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { PluginManifest } from "@pero/plugin-sdk";
import { createUserInTransaction, updateUserInTransaction, revokeUserSessionsInTransaction } from "../../src/server/users/mutation-core";
import { requestTelegramLinkInTransaction, confirmTelegramLinkInTransaction, unlinkTelegramInTransaction } from "../../src/server/telegram/mutation-core";
import { createApiTokenInTransaction, revokeApiTokenInTransaction, savePluginSettingsInTransaction, togglePluginInTransaction } from "../../src/server/plugins/mutation-core";
import { setNotificationPreferenceInTransaction } from "../../src/server/notifications/preference-core";
import { createCounterpartyInTransaction, updateCounterpartyInTransaction } from "../../src/server/counterparties/core";
import { recordAuthenticationEvent } from "../../src/server/auth/journal-events";
import { parseJournalPresentation } from "../../src/server/changelog/presentation";

export class JournalAccountNativeRollback extends Error {
  readonly code = "JOURNAL228_ROLLBACK_COMPLETE";
  constructor(readonly receipt: { runId: string; assertions: number; eventCount: number; eventIds: string[] }) { super("JOURNAL228_ROLLBACK_COMPLETE"); }
}

/** Только в переданном interactive tx после target/W07 guard root. Всегда завершает tx исключением: commit недостижим. */
export async function exerciseJournalAccountNative(tx: Prisma.TransactionClient, input: { runId: string; expectedDatabase: string; auditFailure?: boolean }): Promise<never> {
  if ("$transaction" in tx || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.runId) || !input.expectedDatabase)
    throw new Error("JOURNAL228_NATIVE_GUARD");
  const [identity] = await tx.$queryRaw<{ database: string; readOnly: string }[]>`SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"`;
  if (identity?.database !== input.expectedDatabase || identity.readOnly !== "off") throw new Error("JOURNAL228_NATIVE_TARGET_MISMATCH");
  const prefix = `qa-journal228-${input.runId}`, actorId = `${prefix}-admin`, pluginId = `${prefix}-plugin`;
  if (await tx.user.count({ where: { OR: [{ id: actorId }, { email: { startsWith: prefix } }] } }) || await tx.plugin.findUnique({ where: { id: pluginId } }) ||
      await tx.counterparty.count({ where: { company: { startsWith: prefix } } }) || await tx.changeLog.count({ where: { id: { in: [`auth-login:${input.runId}`, `auth-logout:${input.runId}`] } } }))
    throw new Error("JOURNAL228_NATIVE_OWNERSHIP_CONFLICT");
  const fixtureHash = `fixture-hash-${input.runId}`, token = `pero_fixture_${input.runId.replaceAll("-", "")}`, linkCode = input.runId.replaceAll("-", "").slice(0, 24);
  const digest = createHash("sha256").update("telegram-link:").update(linkCode).digest("hex");
  if (await tx.telegramLinkChallenge.findUnique({ where: { digest } })) throw new Error("JOURNAL228_NATIVE_CODE_CONFLICT");
  await tx.user.create({ data: { id: actorId, email: `${prefix}-admin@example.invalid`, name: `${prefix} администратор`, passwordHash: fixtureHash, roles: ["ADMIN"], payScheme: "NONE" } });
  const actor = { id: actorId, name: `${prefix} администратор`, roles: ["ADMIN"] as const, source: "web" as const };
  const administrator = { ...actor, roles: [...actor.roles] };
  const created = await createUserInTransaction(tx, administrator, { email: `${prefix}-employee@example.invalid`, name: `${prefix} сотрудник`, roles: ["WORKER"],
    payScheme: "PIECE", payPercent: 2, position: "Исходная должность", phone: "000", telegram: "qa228", active: true, passwordHash: fixtureHash });
  assert.ok(created.ok); const employeeId = created.user.id;
  if (input.auditFailure) {
    const faulty = new Proxy(tx, { get(target, property) {
      if (property !== "changeLog") return Reflect.get(target, property);
      return new Proxy(target.changeLog, { get(delegate, method) { return method === "create" ? async () => { throw new Error("JOURNAL228_EXPECTED_AUDIT_FAILURE"); } : Reflect.get(delegate, method); } });
    } });
    await assert.rejects(() => updateUserInTransaction(faulty, administrator, employeeId, { email: created.user.email, name: `${prefix} отказ аудита`, roles: ["WORKER"],
      payScheme: "PIECE", payPercent: 2, active: true }), /JOURNAL228_EXPECTED_AUDIT_FAILURE/);
    // SQL mutation действительно прошла внутри tx; внешний sentinel обязан откатить её вместе с собственными fixtures.
    assert.equal((await tx.user.findUniqueOrThrow({ where: { id: employeeId } })).name, `${prefix} отказ аудита`);
    throw new JournalAccountNativeRollback({ runId: input.runId, assertions: 3, eventCount: 1, eventIds: [] });
  }
  const employeeToken = await createApiTokenInTransaction(tx, administrator, { name: `${prefix} токен сотрудника`, scopes: ["read"], createdById: employeeId }, `${token}_employee`);
  const next = { email: created.user.email, name: `${prefix} изменено`, roles: ["ENGINEER"] as const, payScheme: "PERCENT_PROJECT" as const,
    payPercent: 7, position: "Новая должность", phone: "001", telegram: "qa228new", active: true };
  assert.ok((await updateUserInTransaction(tx, administrator, employeeId, { ...next, roles: [...next.roles] })).ok);
  await revokeUserSessionsInTransaction(tx, administrator, employeeId);
  const current = await tx.user.findUniqueOrThrow({ where: { id: employeeId } });
  assert.equal(current.phone, "001"); assert.equal(current.sessionVersion, created.user.sessionVersion + 2);
  const employee = { id: employeeId, name: current.name, roles: current.roles, source: "web" as const };
  // Только чтение существующей регистрации бота; глобальную настройку probe не меняет.
  const registeredBot = await tx.orgSetting.findUnique({ where: { key: "telegram.botUsername" } });
  if (!registeredBot?.value) throw new Error("JOURNAL228_NATIVE_BOT_REGISTRATION_REQUIRED");
  assert.ok((await requestTelegramLinkInTransaction(tx, employee, linkCode, new Date(Date.now() + 60000))).ok);
  assert.ok((await confirmTelegramLinkInTransaction(tx, { code: linkCode, chatId: String(1 + Number.parseInt(input.runId.replaceAll("-", "").slice(0, 12), 16)), username: "qa228" })).ok);
  await unlinkTelegramInTransaction(tx, employee, employeeId);
  const link = await tx.telegramLink.findUniqueOrThrow({ where: { userId: employeeId } });
  assert.ok(link.revokedAt); assert.equal(link.chatId, null);
  await tx.plugin.create({ data: { id: pluginId, name: prefix, version: "1", apiVersion: 1, permissions: [], enabled: false } });
  const manifest: PluginManifest = { id: pluginId, name: prefix, version: "1", apiVersion: 1, permissions: [],
    settingsSchema: [{ key: "greeting", label: "Приветствие", type: "string", default: "Привет" }, { key: "accessToken", label: "Токен", type: "string" }] };
  await togglePluginInTransaction(tx, administrator, manifest, true);
  await savePluginSettingsInTransaction(tx, administrator, manifest, { greeting: "Новое значение", accessToken: token });
  const api = await createApiTokenInTransaction(tx, administrator, { name: prefix, scopes: ["read"], createdById: actorId, pluginId }, token);
  await revokeApiTokenInTransaction(tx, administrator, api.id); await revokeApiTokenInTransaction(tx, administrator, api.id);
  const counterparty = await createCounterpartyInTransaction(tx, administrator, { type: "SUPPLIER", company: prefix, phone: "000" });
  assert.ok(counterparty.ok);
  assert.ok((await updateCounterpartyInTransaction(tx, administrator, counterparty.item.id, { type: "SUPPLIER", company: prefix, phone: "001", comment: "Изменено" }, counterparty.item.revision)).ok);
  await setNotificationPreferenceInTransaction(tx, administrator, "task.assigned", false, "Задачи");
  await setNotificationPreferenceInTransaction(tx, administrator, "plan.reminder", false, "Личный план");
  await recordAuthenticationEvent(tx, { action: "login", operationId: input.runId, userId: actorId, name: actor.name });
  await recordAuthenticationEvent(tx, { action: "login", operationId: input.runId, userId: actorId, name: actor.name });
  await recordAuthenticationEvent(tx, { action: "logout", operationId: input.runId, userId: actorId, name: actor.name });
  const entries = await tx.changeLog.findMany({ where: { OR: [{ actorId: { in: [actorId, employeeId] } }, { entity: "user", entityId: employeeId }, { entity: "apiToken", entityId: employeeToken.id }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assert.equal(entries.filter(entry => entry.action === "login").length, 1);
  assert.equal(entries.filter(entry => entry.action === "logout").length, 1);
  assert.equal(entries.filter(entry => entry.entity === "apiToken" && entry.entityId === api.id && entry.action === "revoke").length, 1);
  assert.equal(entries.filter(entry => entry.entity === "apiToken" && entry.entityId === employeeToken.id && entry.action === "revoke" && entry.actorType === "system").length, 1);
  assert.equal(entries.filter(entry => entry.entity === "user" && entry.entityId === employeeId && entry.action === "revokeSessions" && entry.actorType === "system").length, 1);
  assert.equal(entries.filter(entry => entry.entity === "notificationPreference").length, 1);
  const views = entries.map(entry => parseJournalPresentation(entry.presentation)); assert.ok(views.every(Boolean));
  const serialized = JSON.stringify(entries); assert.ok(!serialized.includes(fixtureHash)); assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes(linkCode));
  const userEdit = views.find(view => view?.entity.id === employeeId && view.action.code === "update")!;
  for (const key of ["name", "roles", "phone", "telegram", "position", "payScheme", "payPercent"]) assert.ok(userEdit.changes.some(change => change.path === key), key);
  assert.equal(await tx.domainEvent.count({ where: { actor: actorId, type: "plugin.toggled" } }), 1);
  // Root ловит sentinel только СНАРУЖИ prisma.$transaction и затем сверяет сохранность всей БД.
  throw new JournalAccountNativeRollback({ runId: input.runId, assertions: 27, eventCount: entries.length, eventIds: entries.map(entry => entry.id) });
}
