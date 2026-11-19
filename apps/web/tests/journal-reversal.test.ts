import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../src/server/changelog/reversal-core";
import { writeChangeLogInTransaction } from "../src/server/changelog/writer";
import { patchProductCore, updateProductCore } from "../src/server/products/core";

const actor = { id: "admin", name: "Тест", roles: ["ADMIN"] as Role[], source: "web" as const };
type Log = Prisma.ChangeLogUncheckedCreateInput;

function fixture() {
  const product = { id: "product", projectId: "project", number: "1.1", title: "А", titleRevision: 0, kind: null,
    status: "DESIGN", quantity: 1, expectedPrice: null, deletedAt: null };
  const rows = new Map<string, Log>();
  let role: Role = "DIRECTOR";
  let failAudit = false;
  const tx = {
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ ...actor, roles: [role], active: true }) },
    product: {
      findFirst: async () => product.deletedAt ? null : { ...product },
      findUnique: async () => ({ ...product }),
      update: async ({ data }: { data: Partial<typeof product> }) => {
        if (data.title !== undefined && data.title !== product.title) product.titleRevision++;
        return { ...Object.assign(product, data) };
      },
    },
    changeLog: {
      findUnique: async ({ where }: { where: { id?: string; reversesId?: string } }) =>
        where.id ? rows.get(where.id) : [...rows.values()].find(row => row.reversesId === where.reversesId),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id); assert.ok(row); return row;
      },
      create: async ({ data }: { data: Log }) => {
        if (failAudit) throw Error("audit fault");
        const id = data.id ?? randomUUID();
        rows.set(id, { ...data, id });
        return rows.get(id);
      },
    },
  } as unknown as Prisma.TransactionClient;

  async function transaction<T>(run: (client: Prisma.TransactionClient) => Promise<T>) {
    const before = { ...product };
    const oldRows = new Map(rows);
    try { return await run(tx); }
    catch (error) {
      Object.assign(product, before);
      rows.clear();
      for (const [id, row] of oldRows) rows.set(id, row);
      throw error;
    }
  }

  async function rename(expectedValue: string, value: string) {
    const clientMutationId = randomUUID();
    const result = await patchProductCore(actor, { productId: product.id, field: "title", value, expectedValue, clientMutationId }, transaction);
    assert.equal(result.kind, "saved", JSON.stringify(result));
    return `product-inline:${clientMutationId}`;
  }
  const request = (entryId: string) => ({ entryId, scope: { kind: "product", id: product.id }, requestId: randomUUID() });
  return { tx, product, rows, rename, request, transaction, changeRole: (next: Role) => { role = next; }, failAudit: () => { failAudit = true; } };
}

test("undo/redo preserves independent edits and replay returns the same ACK", async () => {
  const f = fixture();
  const entryId = await f.rename("А", "Б");
  const editReceipt = structuredClone(f.rows.get(entryId));
  assert.deepEqual(await updateProductCore(actor, f.product.id, { kind: "Другое" }, { kind: null }, f.transaction),
    { ok: true, noOp: false, before: { ...f.product, kind: null }, after: f.product });
  const request = f.request(entryId);
  assert.equal((await previewJournalReversalInTransaction(f.tx, actor.id, request)).entryId, entryId);
  const result = await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request));
  assert.equal(f.product.title, "А");
  assert.equal(f.product.kind, "Другое");
  assert.deepEqual(f.rows.get(entryId), editReceipt);
  assert.equal(f.rows.get(result.reversalId)?.reversesId, entryId);
  assert.match(JSON.stringify(f.rows.get(result.reversalId)?.presentation), new RegExp(`Откат действия ${entryId}`));
  const count = f.rows.size;
  assert.deepEqual(await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request)), result);
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(entryId))), /уже отменено/);
  assert.equal(f.rows.size, count);
  await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(result.reversalId)));
  assert.equal(f.product.title, "Б");
  assert.equal(f.product.titleRevision, 3);
});

test("ABA, including a newer undo returning identical text, leaves older actions unavailable", async () => {
  const f = fixture();
  const first = await f.rename("А", "Б");
  const second = await f.rename("Б", "В");
  await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(second)));
  assert.equal(f.product.title, "Б");
  await assert.rejects(() => previewJournalReversalInTransaction(f.tx, actor.id, f.request(first)), /поле изменилось/);
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(first))), /поле изменилось/);
});

test("child resolves its root, scoped and live role checks precede changes, audit faults roll back", async () => {
  const f = fixture();
  const root = await f.rename("А", "Б");
  await writeChangeLogInTransaction(f.tx, {
    id: "child", operationRootId: root, actorType: "user", actorId: actor.id, actorName: actor.name,
    entity: "product", entityId: f.product.id, action: "update", field: "kind", oldValue: "before", newValue: "after",
  });
  const request = f.request("child");
  assert.equal((await previewJournalReversalInTransaction(f.tx, actor.id, request)).entryId, root);
  await assert.rejects(() => previewJournalReversalInTransaction(f.tx, actor.id,
    { ...request, scope: { kind: "product", id: "other-product" } }), /не найдена/);
  f.changeRole("ACCOUNTANT");
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request)), /Недостаточно прав/);
  f.changeRole("ADMIN");
  f.failAudit();
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request)), /audit fault/);
  assert.equal(f.product.title, "Б");
  assert.equal(f.product.titleRevision, 1);
  assert.equal(f.rows.size, 2);
});
