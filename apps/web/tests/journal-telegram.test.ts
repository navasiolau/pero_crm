import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { requestTelegramLinkInTransaction, confirmTelegramLinkInTransaction, unlinkTelegramInTransaction, unlinkTelegramChatInTransaction, registerTelegramBotInTransaction } from "../src/server/telegram/mutation-core";
import { parseJournalPresentation } from "../src/server/changelog/presentation";

const actor = { id: "user-telegram", name: "Иван", roles: ["WORKER"] as const, source: "web" as const };
const person = { ...actor, roles: [...actor.roles], active: true };
function fixture() {
  let link: Record<string, unknown> | null = null, username = "old_bot", failAudit = false;
  const audits: Prisma.ChangeLogCreateInput[] = [];
  const by = (where: Record<string, unknown>) => link && Object.entries(where).every(([key, value]) => link![key] === value) ? { ...link, user: person } : null;
  const tx = { $queryRaw: async () => [], user: { findUnique: async () => person }, orgSetting: {
    findUnique: async () => ({ key: "telegram.botUsername", value: username }),
    upsert: async ({ update }: { update: { value: string } }) => { username = update.value; return { key: "telegram.botUsername", value: username }; },
  }, telegramLink: {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => by(where), findFirst: async () => null,
    upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      link = link ? { ...link, ...update } : { id: "link-id", chatId: null, username: null, linkedAt: null, ...create }; return link;
    },
    update: async ({ data }: { data: Record<string, unknown> }) => { link = { ...link, ...data }; return link; },
    deleteMany: async () => { const count = link ? 1 : 0; link = null; return { count }; },
  }, changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (failAudit) throw new Error("AUDIT_FAILED"); audits.push(data); return data; } } };
  return { tx: tx as unknown as Prisma.TransactionClient, audits, get link() { return link; }, fail: () => { failAudit = true; } };
}

test("request/link/unlink record human Telegram identity and never the one-time code", async () => {
  const f = fixture(), human = { ...actor, roles: [...actor.roles] };
  await requestTelegramLinkInTransaction(f.tx, human, "SECRET22", new Date(Date.now() + 60000));
  const result = await confirmTelegramLinkInTransaction(f.tx, { code: "SECRET22", chatId: "chat-1", username: "ivan" });
  assert.equal(result.ok, true);
  await unlinkTelegramChatInTransaction(f.tx, "chat-1");
  assert.deepEqual(f.audits.map(row => [row.action, row.actorId, row.source]), [["link.request", actor.id, "web"], ["link", actor.id, "telegram"], ["unlink", actor.id, "telegram"]]);
  assert.ok(!JSON.stringify(f.audits).includes("SECRET22")); assert.equal(f.link, null);
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
