import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type User } from "@prisma/client";
import type { DomainActor } from "../src/server/actor";
import { createUserInTransaction, updateUserInTransaction, revokeUserSessionsInTransaction } from "../src/server/users/mutation-core";
import { parseJournalPresentation } from "../src/server/changelog/presentation";

const admin: DomainActor = { id: "admin", name: "Администратор", roles: ["ADMIN"], source: "web" };
const initial = { id: "employee", email: "worker@example.invalid", name: "Иван", position: "Работник", phone: "123", telegram: "ivan",
  roles: ["WORKER"], payScheme: "PIECE", payPercent: new Prisma.Decimal(5), active: true, calendarEnabled: null, passwordHash: "hash-secret", sessionVersion: 0 } as unknown as User;
const settings = { email: initial.email, name: "Иван Новый", position: "Сборщик", phone: "456", telegram: "ivan-new", roles: ["ENGINEER"] as User["roles"],
  payScheme: "PERCENT_PROJECT" as const, payPercent: 7, active: false, calendarEnabled: true };

function fixture() {
  let row = structuredClone({ ...initial, payPercent: "5" });
  const audits: Prisma.ChangeLogCreateInput[] = [];
  let rejectAudit = false, writes = 0;
  const tx = { $queryRaw: async () => [{ id: "employee" }], user: {
    findUnique: async () => row,
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => { writes++; row = { ...row, ...data } as typeof row; return row; },
    update: async ({ data }: { data: Record<string, unknown> }) => { writes++; row = { ...row, ...data, sessionVersion: typeof data.sessionVersion === "object" ? row.sessionVersion + 1 : row.sessionVersion } as typeof row; return row; },
  }, apiToken: { findMany: async () => [] }, changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (rejectAudit) throw new Error("AUDIT_FAILED"); audits.push(data); return { id: `audit-${audits.length}`, ...data }; } } };
  return { tx: tx as unknown as Prisma.TransactionClient, audits, get row() { return row; }, get writes() { return writes; }, fail: () => { rejectAudit = true; } };
}

test("all changed employee fields appear with safe before/after and unchanged raw identity", async () => {
  const f = fixture(); const result = await updateUserInTransaction(f.tx, admin, initial.id, { ...settings, passwordHash: "new-hash-secret" });
  assert.equal(result.ok, true); assert.equal(f.audits.length, 1);
  const audit = f.audits[0]!, view = parseJournalPresentation(audit.presentation)!;
  assert.equal(view.entity.label, "Пользователь Иван Новый");
  for (const field of ["name", "position", "phone", "telegram", "roles", "payScheme", "payPercent", "active", "calendarEnabled", "passwordChanged"])
    assert.ok(view.changes.some(change => change.path === field), field);
  assert.equal(audit.actorId, "admin");
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
  const audits: Prisma.ChangeLogCreateInput[] = [];
  const before = { ...initial }, token = { id: "owned-token", name: "Интеграция", prefix: "pero_x", scopes: ["read"], pluginId: null,
    createdById: initial.id, createdAt: new Date("2026-01-01T00:00:00Z"), revokedAt: null as Date | null, tokenHash: "private-token-hash" };
  const tx = { $queryRaw: async () => [], user: { findUnique: async () => before, findFirst: async () => null,
    update: async ({ data }: { data: Record<string, unknown> }) => { token.revokedAt = new Date(); return { ...before, ...data, sessionVersion: 1 }; } },
    apiToken: { findMany: async () => [{ ...token }] },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { audits.push(data); return { id: `event-${audits.length}`, ...data }; } },
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
