import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type User } from "@prisma/client";
import type { DomainActor } from "../src/server/actor";
import { createUserInTransaction, updateUserInTransaction, revokeUserSessionsInTransaction } from "../src/server/users/mutation-core";
import { verifyPassword } from "../src/lib/password";
import { userCreationReversal } from "../src/server/users/creation-reversal";
import { userSettingsReversal } from "../src/server/users/settings-reversal";
import { parseJournalPresentation } from "../src/server/changelog/presentation";

const admin: DomainActor = { id: "admin", name: "Администратор", roles: ["ADMIN"], source: "web" };
const initial = { id: "employee", email: "worker@example.invalid", name: "Иван", position: "Работник", phone: "123", telegram: "ivan",
  roles: ["WORKER"], payScheme: "PIECE", payPercent: new Prisma.Decimal(5), active: true, calendarEnabled: null, passwordHash: "hash-secret", sessionVersion: 0, accountRevision: 0 } as unknown as User;
const settings = { email: initial.email, name: "Иван Новый", position: "Сборщик", phone: "456", telegram: "ivan-new", roles: ["ENGINEER"] as User["roles"],
  payScheme: "PERCENT_PROJECT" as const, payPercent: 7, active: false, calendarEnabled: true };

function fixture({ securityTrigger = false } = {}) {
  let row = structuredClone({ ...initial, payPercent: "5" });
  const audits: Prisma.ChangeLogUncheckedCreateInput[] = [];
  let rejectAudit = false, writes = 0, dependency: string | null = null, otherAdmins = 1;
  const tx = { $queryRaw: async () => [{ id: "employee", acquired: true }],
    task: { findFirst: async () => dependency === "task" ? { id: "open-task" } : null },
    project: { findFirst: async () => dependency === "project" ? { id: "open-project" } : null },
    product: { findFirst: async () => dependency === "product" ? { id: "open-product" } : null },
    productPercentageParticipant: { findFirst: async () => dependency === "percentage" ? { id: "open-participation" } : null },
    timeEntry: { findFirst: async () => dependency === "timer" ? { id: "running" } : null },
    telegramLink: { findUnique: async () => null },
    user: {
    findUnique: async () => row,
    count: async () => otherAdmins,
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => { writes++; row = { ...row, ...data } as typeof row; return row; },
    update: async ({ data }: { data: Record<string, unknown> }) => { writes++; const changed = Object.entries(data).some(([key, value]) => key !== "calendarEnabled" && JSON.stringify(row[key as keyof typeof row]) !== JSON.stringify(value));
      row = { ...row, ...data, accountRevision: row.accountRevision + Number(changed), sessionVersion: typeof data.sessionVersion === "object" || (securityTrigger && (data.active !== row.active || data.passwordHash)) ? row.sessionVersion + 1 : row.sessionVersion } as typeof row; return row; },
  }, apiToken: { findMany: async () => [] }, changeLog: { create: async ({ data }: { data: Prisma.ChangeLogUncheckedCreateInput }) => { if (rejectAudit) throw new Error("AUDIT_FAILED"); audits.push(data); return { id: `audit-${audits.length}`, ...data }; } } };
  return { tx: tx as unknown as Prisma.TransactionClient, audits, get row() { return row; }, get writes() { return writes; }, setDependency: (value: string | null) => { dependency = value; }, setOtherAdmins: (value: number) => { otherAdmins = value; }, fail: () => { rejectAudit = true; } };
}

test("all changed employee fields appear with safe before/after and unchanged raw identity", async () => {
  const f = fixture(); const result = await updateUserInTransaction(f.tx, admin, initial.id, { ...settings, passwordHash: "new-hash-secret" });
  assert.equal(result.ok, true); assert.equal(f.audits.length, 1);
  const audit = f.audits[0]!, view = parseJournalPresentation(audit.presentation)!;
  assert.equal(view.entity.label, "Пользователь Иван Новый");
  for (const field of ["name", "position", "phone", "telegram", "roles", "payScheme", "payPercent", "active", "passwordChanged"])
    assert.ok(view.changes.some(change => change.path === field), field);
  assert.equal(audit.actorId, "admin");
  assert.ok(!JSON.stringify(audit).includes("calendarEnabled"));
  assert.equal((audit.reversal as { kind: string }).kind, "account.settings");
  assert.ok(!JSON.stringify(audit).includes("hash-secret"));
  assert.equal(f.row.passwordHash, "new-hash-secret");
});

test("identical employee update is no-op and undefined calendar override stays unchanged", async () => {
  const f = fixture(); const result = await updateUserInTransaction(f.tx, admin, initial.id, { ...settings, email: initial.email, name: initial.name,
    position: initial.position!, phone: initial.phone!, telegram: initial.telegram!, roles: initial.roles, payScheme: initial.payScheme, payPercent: 5, active: true,
    calendarEnabled: undefined });
  assert.equal(result.ok, true); assert.equal(f.writes, 0); assert.equal(f.audits.length, 0);
});

test("mandatory user audit failure propagates and forbidden core call does not write", async () => {
  const f = fixture(); f.fail();
  await assert.rejects(() => updateUserInTransaction(f.tx, admin, initial.id, settings), /AUDIT_FAILED/);
  const forbidden = fixture();
  await assert.rejects(() => updateUserInTransaction(forbidden.tx, { ...admin, roles: ["MANAGER"] }, initial.id, settings), /Недостаточно прав/);
  assert.equal(forbidden.writes, 0);
});

test("creation and session revocation have full safe snapshots", async () => {
  const f = fixture();
  await createUserInTransaction(f.tx, admin, { ...settings, passwordHash: "create-secret" });
  await revokeUserSessionsInTransaction(f.tx, admin, initial.id);
  assert.deepEqual(f.audits.map(audit => audit.action), ["create", "revokeSessions"]);
  const change = parseJournalPresentation(f.audits[1]!.presentation)!.changes.find(item => item.path === "sessionVersion");
  assert.equal(change?.before, 0); assert.equal(change?.after, 1);
  assert.ok(!JSON.stringify(f.audits).includes("create-secret"));
});

test("actual trigger consequences are attributed to System without altering role or token semantics", async () => {
  const audits: Prisma.ChangeLogUncheckedCreateInput[] = [];
  const before = { ...initial }, token = { id: "owned-token", name: "Интеграция", prefix: "pero_x", scopes: ["read"], pluginId: null,
    createdById: initial.id, createdAt: new Date("2026-01-01T00:00:00Z"), revokedAt: null as Date | null, tokenHash: "private-token-hash" };
  const tx = { $queryRaw: async () => [], user: { findUnique: async () => before, findFirst: async () => null,
    update: async ({ data }: { data: Record<string, unknown> }) => { token.revokedAt = new Date(); return { ...before, ...data, sessionVersion: 1 }; } },
    apiToken: { findMany: async () => [{ ...token }] },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogUncheckedCreateInput }) => { audits.push(data); return { id: `event-${audits.length}`, ...data }; } },
  } as unknown as Prisma.TransactionClient;
  await updateUserInTransaction(tx, admin, initial.id, settings);
  assert.deepEqual(audits.map(row => [row.actorType, row.entity, row.action]), [["user", "user", "update"], ["system", "user", "revokeSessions"], ["system", "apiToken", "revoke"]]);
  const manual = parseJournalPresentation(audits[0]!.presentation)!, automatic = parseJournalPresentation(audits[2]!.presentation)!;
  assert.ok(!manual.changes.some(change => change.path === "sessionVersion"));
  assert.equal((audits[0]!.newValue as { sessionVersion: number }).sessionVersion, 1);
  assert.equal(automatic.initiator?.id, admin.id); assert.equal(automatic.actor.name, "Система");
  assert.ok(automatic.changes.some(change => change.path === "revokedAt" && change.before === null));
  assert.ok(!JSON.stringify(audits).includes("private-token-hash"));
});


test("personal calendar setting writes only the user row and emits zero journal entries", async () => {
  const f = fixture();
  const result = await updateUserInTransaction(f.tx, admin, initial.id, { email: initial.email, name: initial.name,
    position: initial.position!, phone: initial.phone!, telegram: initial.telegram!, roles: initial.roles, payScheme: initial.payScheme,
    payPercent: 5, active: true, calendarEnabled: false });
  assert.ok(result.ok); assert.equal(f.row.calendarEnabled, false);
  assert.equal(f.writes, 1); assert.equal(f.audits.length, 0);
});

test("account reversal restores allowed settings once and leaves the issued password unchanged", async () => {
  const f = fixture();
  assert.ok((await updateUserInTransaction(f.tx, admin, initial.id, { ...settings, passwordHash: "new-hash-secret" })).ok);
  const root = f.audits[0]!.reversal as { data: unknown };
  const handler = userSettingsReversal.read(root.data);
  assert.ok(handler);
  const ctx = { tx: f.tx, actor: admin, entryId: "audit-1", entityId: initial.id };
  assert.equal(await handler.preview(ctx), null);
  await handler.apply(ctx);
  assert.equal(f.row.name, initial.name); assert.deepEqual(f.row.roles, initial.roles); assert.equal(f.row.active, true);
  assert.equal(f.row.passwordHash, "new-hash-secret"); assert.equal(f.row.calendarEnabled, true);
  await assert.rejects(() => handler.apply(ctx), /после записи/);
});


test("user creation compensation refuses self, the last administrator and current operational dependencies", async () => {
  const f = fixture();
  const result = await createUserInTransaction(f.tx, admin, { ...settings, active: true, roles: ["ADMIN"], passwordHash: "old-secret" });
  assert.ok(result.ok);
  const root = f.audits[0]!.reversal as { data: unknown };
  const handler = userCreationReversal.read(root.data); assert.ok(handler);
  const ctx = { tx: f.tx, actor: admin, entryId: "entry", entityId: result.user.id };
  await assert.rejects(() => handler.apply({ ...ctx, actor: { ...admin, id: result.user.id } }), /собственную/);
  f.setOtherAdmins(0);
  await assert.rejects(() => handler.apply(ctx), /администратор/);
  f.setOtherAdmins(1);
  for (const dependency of ["task", "project", "product", "percentage", "timer"]) {
    f.setDependency(dependency);
    await assert.rejects(() => handler.apply(ctx), /Переназначьте/);
  }
  assert.equal(f.writes, 1);
  assert.equal(f.row.active, true);
});

test("compensating account creation keeps its ID, rotates credentials and forbids redo from the journal", async () => {
  const f = fixture({ securityTrigger: true });
  const result = await createUserInTransaction(f.tx, admin, { ...settings, active: true, passwordHash: "old-password" });
  assert.ok(result.ok);
  const handler = userCreationReversal.read((f.audits[0]!.reversal as { data: unknown }).data); assert.ok(handler);
  const ctx = { tx: f.tx, actor: admin, entryId: "entry", entityId: result.user.id };
  assert.match(handler.confirmation ?? "", /перестанут действовать/);
  const effect = await handler.apply(ctx);
  assert.equal(f.row.id, result.user.id);
  assert.equal(f.row.active, false);
  assert.ok(f.row.sessionVersion > result.user.sessionVersion);
  assert.equal(await verifyPassword(f.row.passwordHash, "old-password"), false);
  await effect.afterWrite?.("new-journal-root");
  assert.equal(f.audits.at(-1)?.operationRootId, "new-journal-root");
  assert.ok(!JSON.stringify([effect, ...f.audits]).includes(f.row.passwordHash));
  const terminal = userCreationReversal.read(effect.reversal.data); assert.ok(terminal);
  await assert.rejects(() => terminal.apply(ctx), /выдача нового пароля/);
});
