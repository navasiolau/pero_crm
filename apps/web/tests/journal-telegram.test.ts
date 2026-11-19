import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { requestTelegramLinkInTransaction, confirmTelegramLinkInTransaction, unlinkTelegramInTransaction, unlinkTelegramChatInTransaction, registerTelegramBotInTransaction } from "../src/server/telegram/mutation-core";
import { telegramLinkReversal } from "../src/server/telegram/link-reversal";
import { parseJournalPresentation } from "../src/server/changelog/presentation";

const actor = { id: "user-telegram", name: "Иван", roles: ["WORKER"] as const, source: "web" as const };
const person = { ...actor, roles: [...actor.roles], active: true, sessionVersion: 0 };
function fixture() {
  let link: Record<string, unknown> | null = null, username = "old_bot", failAudit = false;
  const challenges = new Set<string>();
  const audits: Prisma.ChangeLogCreateInput[] = [];
  const by = (where: Record<string, unknown>) => link && Object.entries(where).every(([key, value]) => link![key] === value) ? { ...link, user: person } : null;
  const tx = { $queryRaw: async () => [], user: { findUnique: async () => person }, orgSetting: {
    findUnique: async () => ({ key: "telegram.botUsername", value: username }),
    upsert: async ({ update }: { update: { value: string } }) => { username = update.value; return { key: "telegram.botUsername", value: username }; },
  }, telegramLinkChallenge: { createMany: async ({ data }: { data: { digest: string } }) => {
    if (challenges.has(data.digest)) return { count: 0 };
    challenges.add(data.digest);
    return { count: 1 };
  } }, telegramLink: {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => by(where), findFirst: async () => null,
    upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      link = link ? { ...link, ...update } : { id: "link-id", chatId: null, username: null, linkedAt: null, generation: 0, revokedAt: null, ...create }; return link;
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      const generation = data.generation ? Number(link?.generation) + 1 : link?.generation;
      link = { ...link, ...data, generation };
      return link;
    },
  }, changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (failAudit) throw new Error("AUDIT_FAILED"); audits.push(data); return data; } } };
  return { tx: tx as unknown as Prisma.TransactionClient, audits, get link() { return link; }, fail: () => { failAudit = true; } };
}

test("request/link/unlink record human Telegram identity and never the one-time code", async () => {
  const f = fixture(), human = { ...actor, roles: [...actor.roles] };
  await requestTelegramLinkInTransaction(f.tx, human, "SECRET22", new Date(Date.now() + 60000));
  const result = await confirmTelegramLinkInTransaction(f.tx, { code: "SECRET22", chatId: "555123", username: "ivan" });
  assert.equal(result.ok, true);
  await unlinkTelegramChatInTransaction(f.tx, "555123");
  assert.deepEqual(f.audits.map(row => [row.action, row.actorId, row.source]), [["link.request", actor.id, "web"], ["link", actor.id, "telegram"], ["unlink", actor.id, "telegram"]]);
  assert.ok(!JSON.stringify(f.audits).includes("SECRET22")); assert.equal(f.link?.id, "link-id");
  assert.equal(f.link?.chatId, null);
  assert.ok(f.link?.revokedAt);
  assert.equal(f.link?.generation, 2);
  assert.equal((await requestTelegramLinkInTransaction(f.tx, human, "SECRET22", new Date(Date.now() + 60000))).ok, false);
  await requestTelegramLinkInTransaction(f.tx, human, "SECRET33", new Date(Date.now() + 60000));
  assert.equal((await confirmTelegramLinkInTransaction(f.tx, { code: "SECRET22", chatId: "555123" })).ok, false);
  const rebind = await confirmTelegramLinkInTransaction(f.tx, { code: "SECRET33", chatId: "555123" });
  assert.equal(rebind.ok && rebind.binding, "link-id:3:0");
  assert.equal((await unlinkTelegramChatInTransaction(f.tx, "555123", "link-id:1:0")).deleted, 0);
  assert.equal(parseJournalPresentation(f.audits[1]!.presentation)?.actor.type, "user");
});

test("invalid code and repeated unlink/registration produce no false successful changes", async () => {
  const f = fixture();
  assert.equal((await confirmTelegramLinkInTransaction(f.tx, { code: "missing", chatId: "chat" })).ok, false);
  await unlinkTelegramInTransaction(f.tx, { ...actor, roles: [...actor.roles] }, actor.id);
  await registerTelegramBotInTransaction(f.tx, "old_bot"); assert.equal(f.audits.length, 0);
  await registerTelegramBotInTransaction(f.tx, "new_bot"); await registerTelegramBotInTransaction(f.tx, "new_bot");
  assert.equal(f.audits.length, 1); assert.equal(parseJournalPresentation(f.audits[0]!.presentation)?.actor.name, "Система");
});

test("Telegram mandatory audit failure propagates and other user's link needs previous admin grant", async () => {
  const f = fixture(); f.fail();
  await assert.rejects(() => requestTelegramLinkInTransaction(f.tx, { ...actor, roles: [...actor.roles] }, "SECRET22", new Date(Date.now() + 60000)), /AUDIT_FAILED/);
  await assert.rejects(() => unlinkTelegramInTransaction(f.tx, { ...actor, roles: [...actor.roles] }, "another-user"), /Недостаточно прав/);
});


test("undoing a live Telegram link revokes it and redo requires fresh code", async () => {
  const f = fixture(), human = { ...actor, roles: [...actor.roles] };
  await requestTelegramLinkInTransaction(f.tx, human, "ONE-USE-CODE", new Date(Date.now() + 60000));
  assert.ok((await confirmTelegramLinkInTransaction(f.tx, { code: "ONE-USE-CODE", chatId: "555123" })).ok);
  const command = f.audits.at(-1)!.reversal as { data: unknown };
  const handler = telegramLinkReversal.read(command.data); assert.ok(handler);
  const ctx = { tx: f.tx, actor: { ...human, roles: ["ADMIN" as const] }, entryId: "audit-1", entityId: actor.id };
  assert.equal(await handler.preview(ctx), null);
  const result = await handler.apply(ctx);
  assert.equal(f.link?.id, "link-id"); assert.equal(f.link?.chatId, null); assert.ok(f.link?.revokedAt);
  const future = telegramLinkReversal.read(result.reversal.data); assert.ok(future);
  await assert.rejects(() => future.apply(ctx), /одноразовый код/);
  assert.equal(f.audits.length, 2, "reversal engine creates the only root");
});


test("an old link reversal cannot touch another chat after rebind", async () => {
  const f = fixture(), human = { ...actor, roles: [...actor.roles] };
  await requestTelegramLinkInTransaction(f.tx, human, "OLD-CODE", new Date(Date.now() + 60000));
  assert.ok((await confirmTelegramLinkInTransaction(f.tx, { code: "OLD-CODE", chatId: "555123" })).ok);
  const handler = telegramLinkReversal.read((f.audits.at(-1)!.reversal as { data: unknown }).data); assert.ok(handler);
  await unlinkTelegramInTransaction(f.tx, human, actor.id);
  await requestTelegramLinkInTransaction(f.tx, human, "OTHER-CODE", new Date(Date.now() + 60000));
  assert.ok((await confirmTelegramLinkInTransaction(f.tx, { code: "OTHER-CODE", chatId: "555456" })).ok);
  const ctx = { tx: f.tx, actor: { ...human, roles: ["ADMIN" as const] }, entryId: "audit-old", entityId: actor.id };
  await assert.rejects(() => handler.apply(ctx), /изменилась/);
  assert.equal(f.link?.chatId, "555456");
});
