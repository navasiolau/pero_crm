import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../src/server/changelog/reversal-core";
import { writeChangeLogInTransaction } from "../src/server/changelog/writer";
import { patchProjectCore } from '../src/server/projects/project-field-core';
import { patchProductCore, updateProductCore } from "../src/server/products/core";

const actor = { id: "admin", name: "Тест", roles: ["ADMIN"] as Role[], source: "web" as const };
type Log = Prisma.ChangeLogUncheckedCreateInput;

function fixture() {
  const product = { id: "product", projectId: "project", number: "1.1", title: "А", titleRevision: 0, kind: null,
    status: "DESIGN", quantity: 1, expectedPrice: null, deletedAt: null };
  const project = { id: "project", title: "До", currency: "BYN", number: "1", servicesTotal: null as string | null,
    delivery: "12.00" as string | null, unloading: null as string | null, installation: null as string | null,
    fieldRevisions: {} as Record<string, number>, clientId: "client", managerId: null, address: null, contactPerson: null };
  const rows = new Map<string, Log>();
  let role: Role = "DIRECTOR";
  let failAudit = false;
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => {
      assert.doesNotMatch(query.join(" "), /FROM\s+"ChangeLog".*FOR\s+(?:NO KEY )?UPDATE/i);
      return query.join("").includes("pricingVersion") ? [{ pricingVersion: "1" }] : [];
    },
    domainEvent: { create: async () => ({ id: randomUUID() }) },
    project: {
      findUnique: async () => ({ ...project }),
      findUniqueOrThrow: async () => ({ ...project }),
      update: async ({ data }: { data: Partial<typeof project> }) => {
        const serviceKeys = ["servicesTotal", "delivery", "unloading", "installation"] as const;
        const key = serviceKeys.join(",");
        const next = { ...project.fieldRevisions };
        if (serviceKeys.some(field => field in data && project[field] !== data[field])) next[key] = (next[key] ?? 0) + 1;
        if (data.title !== undefined && data.title !== project.title) next.title = (next.title ?? 0) + 1;
        return { ...Object.assign(project, data, { fieldRevisions: next }) };
      },
    },
    user: { findUnique: async () => ({ ...actor, roles: [role], active: true }) },
    product: {
      findFirst: async () => product.deletedAt ? null : { ...product },
      findMany: async () => [{ ...product }],
      findUnique: async () => ({ ...product }),
      update: async ({ data }: { data: Partial<typeof product> }) => {
        if (data.title !== undefined && data.title !== product.title) product.titleRevision++;
        return { ...Object.assign(product, data) };
      },
    },
    changeLog: {
      findMany: async ({ where }: { where: { entity: string; entityId: string; AND: { reversal: { equals: unknown } }[] } }) =>
        [...rows.values()].filter(row => {
          const payload = row.reversal as { kind?: string; data?: { revision?: number } } | undefined;
          return row.entity === where.entity && row.entityId === where.entityId &&
            payload?.kind === where.AND[0].reversal.equals && payload?.data?.revision === where.AND[1].reversal.equals;
        }),
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
    const beforeProject = { ...project };
    const oldRows = new Map(rows);
    try { return await run(tx); }
    catch (error) {
      Object.assign(product, before);
      Object.assign(project, beforeProject);
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
  return { tx, product, project, rows, rename, request, transaction, changeRole: (next: Role) => { role = next; }, failAudit: () => { failAudit = true; } };
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
  assert.deepEqual(result.cachePaths, ["/products", "/products/1.1", "/projects", "/projects/project"]);
  assert.equal((await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request))).reversalId, result.reversalId);
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(entryId))), /уже отменено/);
  assert.equal(f.rows.size, count);
  await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(result.reversalId)));
  assert.equal(f.product.title, "Б");
  assert.equal(f.product.titleRevision, 3);
});

test("later recorded reversals enable undo and redo in order with original title payloads", async () => {
  const f = fixture();
  const reverse = (id: string) => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(id)));
  const first = await f.rename("А", "Б");
  const second = await f.rename("Б", "В");
  await assert.rejects(() => reverse(first), /поле изменилось/);
  const undoSecond = await reverse(second);
  const old = f.rows.get(undoSecond.reversalId)!;
  // Предыдущий релиз не сохранял логическую версию результата.
  old.reversal = { kind: "product.title", version: 1, data: { previous: "В", expected: "Б", revision: 3 } };
  assert.equal(f.product.title, "Б");
  const undoFirst = await reverse(first);
  assert.equal(f.product.title, "А");
  await assert.rejects(() => reverse(undoSecond.reversalId), /поле изменилось/);
  await reverse(undoFirst.reversalId);
  assert.equal(f.product.title, "Б");
  await reverse(undoSecond.reversalId);
  assert.equal(f.product.title, "В");
  assert.equal(f.product.titleRevision, 6);
});

test("ordinary ABA edits leave earlier actions unavailable and name the blocking event", async () => {
  const f = fixture();
  const first = await f.rename("А", "Б");
  await f.rename("Б", "В");
  const last = await f.rename("В", "Б");
  await assert.rejects(() => previewJournalReversalInTransaction(f.tx, actor.id, f.request(first)),
    { message: "После этого действия поле изменилось", href: `/changelog?q=${encodeURIComponent(last)}` });
  assert.equal(f.product.title, "Б");
});

test("service-mode reversal restores the split without overwriting an independently changed project title", async () => {
  const f = fixture();
  const clientMutationId = randomUUID();
  assert.equal((await patchProjectCore(actor, { projectId: f.project.id, field: "servicesTotal",
    value: "30.00", expectedValue: null, clientMutationId,
    expectedServices: { servicesTotal: null, delivery: "12.00", unloading: null, installation: null },
  }, f.transaction)).kind, "saved");
  assert.equal(f.project.delivery, null);
  await patchProjectCore(actor, { projectId: f.project.id, field: "title", value: "После", expectedValue: "До", clientMutationId: randomUUID() }, f.transaction);
  const result = await f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, {
    entryId: `project-inline:${clientMutationId}`, requestId: randomUUID(), scope: { kind: "project", id: f.project.id },
  }));
  assert.equal(f.project.title, "После");
  assert.equal(f.project.servicesTotal, null);
  assert.equal(f.project.delivery, "12.00");
  assert.equal(result.eventIds?.length, 1);
});

test("a conflict without an identified newer event links to the affected product history", async () => {
  const f = fixture();
  const first = await f.rename("А", "Б");
  await f.tx.product.update({ where: { id: f.product.id }, data: { title: "Внешняя правка" } });
  const conflict = { message: "После этого действия поле изменилось", href: "/changelog?q=product" };
  await assert.rejects(() => previewJournalReversalInTransaction(f.tx, actor.id, f.request(first)), conflict);
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, f.request(first))), conflict);
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
    { ...request, scope: { kind: "product", id: "other-product" } }), { message: "Запись журнала не найдена", href: undefined });
  f.changeRole("ACCOUNTANT");
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request)), { message: "Недостаточно прав", href: undefined });
  f.changeRole("ADMIN");
  f.failAudit();
  await assert.rejects(() => f.transaction(tx => reverseJournalActionInTransaction(tx, actor.id, request)), (error: unknown) => error instanceof Error && error.message === "audit fault" && !("href" in error));
  assert.equal(f.product.title, "Б");
  assert.equal(f.product.titleRevision, 1);
  assert.equal(f.rows.size, 2);
});
