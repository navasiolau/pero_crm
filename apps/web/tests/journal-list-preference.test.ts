import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma, PrismaClient, SavedListChoiceRevision, UserPreference } from "@prisma/client";
import { decodeListPreference } from "../src/lib/list-state";
import { createListPreferenceService } from "../src/server/list-preference-service";
import { createPrismaListPreferenceStore } from "../src/server/list-preference-store";
import { savedListChoiceReversal } from "../src/server/list-preference-reversal";

test("typed list settings restore a private snapshot across all three sections only at the saved revision", async () => {
  const values = new Map<string, UserPreference>(), history = new Map<string, SavedListChoiceRevision>();
  const journal: Prisma.ChangeLogCreateInput[] = [];
  const keyOf = (userId: string, key: string) => `${userId}/${key}`;
  const tx = {
    userPreference: {
      findUnique: async ({ where: { userId_key: { userId, key } } }: { where: { userId_key: { userId: string; key: string } } }) => values.get(keyOf(userId, key)) ?? null,
      createMany: async ({ data }: { data: Omit<UserPreference,"revision"> }) => {
        const key = keyOf(data.userId, data.key);
        if (values.has(key)) return { count: 0 };
        values.set(key, { ...data, revision: 0 }); return { count: 1 };
      },
      updateMany: async ({ where, data }: { where: { userId: string; key: string; value: string }; data: { value: string } }) => {
        const key = keyOf(where.userId, where.key), row = values.get(key);
        if (row?.value !== where.value) return { count: 0 };
        values.set(key, { ...row, value: data.value, revision: row.revision + 1 }); return { count: 1 };
      },
    },
    savedListChoiceRevision: {
      findUnique: async ({ where }: { where: { id: string } }) => history.get(where.id) ?? null,
      create: async ({ data }: { data: Omit<SavedListChoiceRevision,"createdAt"> }) => {
        const row = { ...data, createdAt: new Date() }; history.set(data.id, row); return row;
      },
    },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { journal.push(data); return data; } },
  };
  const prisma = { ...tx, $transaction: async (run: (tx: object) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  const actor = { id: "admin", name: "Admin", source: "web" as const, roles: ["ADMIN" as const] };
  const service = createListPreferenceService({ store: createPrismaListPreferenceStore(prisma), sessionUser: async () => actor, revision: randomUUID });
  values.set("other/organizationExpenses.list", { userId: "other", key: "organizationExpenses.list", value: "other-value", revision: 0 });
  for (const section of ["projects", "products", "organizationExpenses"] as const) {
    const first = await service.save(section, "view=table&q=sensitive-before", null);
    const second = await service.save(section, "view=kanban&q=sensitive-after", first.value);
    assert.ok(second.ok);
    const repeated = await service.save(section, "view=kanban&q=sensitive-after", second.value);
    assert.equal(repeated.value, second.value);
    const entry = journal.at(-1)!;
    const handler = savedListChoiceReversal.read((entry.reversal as { data: unknown }).data); assert.ok(handler);
    const ctx = { tx: tx as unknown as Prisma.TransactionClient, actor, entryId: "change", entityId: entry.entityId };
    assert.equal(await handler.preview(ctx), null);
    await handler.apply(ctx);
    const restored = values.get(`admin/${section}.list`)?.value ?? null;
    assert.equal(new URLSearchParams(decodeListPreference(section, restored)!).get("q"), "sensitive-before");
    assert.equal((await service.save(section, "q=older-save", second.value)).ok, false);
    await assert.rejects(() => handler.apply(ctx), /изменился/);
  }
  assert.equal(values.get("other/organizationExpenses.list")?.value, "other-value");
  assert.ok(!JSON.stringify(journal).includes("sensitive-"));
});
