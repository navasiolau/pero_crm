import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { FinanceDocument, Prisma, Role } from "@prisma/client";
import { createFinanceDocumentService, type FinanceDocumentStorage } from "../src/server/finance-documents/core";

type Row = FinanceDocument & { payment: { id: string } | null };
function fixture() {
  const users = new Map<string, { id: string; name: string; active: boolean; roles: Role[] }>([
    ["accountant", { id: "accountant", name: "Бухгалтер", active: true, roles: ["ACCOUNTANT"] }],
    ["supply", { id: "supply", name: "Снабженец", active: true, roles: ["PROCUREMENT"] }],
    ["manager", { id: "manager", name: "Менеджер", active: true, roles: ["MANAGER"] }],
  ]);
  let rows: Row[] = [], audits: unknown[] = [], puts = 0, reads = 0;
  let failStore = false, onPut = () => {};
  const tx = {
    $queryRaw: async () => [],
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    financeDocument: {
      findUnique: async ({ where }: { where: { id?: string; clientMutationId?: string } }) =>
        rows.find(row => where.id ? row.id === where.id : row.clientMutationId === where.clientMutationId) ?? null,
      create: async ({ data }: { data: FinanceDocument }) => {
        const row = { ...data, createdAt: new Date(), readyAt: null, payment: null };
        rows.push(row); return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FinanceDocument> }) => {
        const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return row;
      },
    },
    changeLog: { create: async ({ data }: { data: unknown }) => { audits.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  let queue: Promise<unknown> = Promise.resolve();
  const transaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const before = structuredClone(rows), beforeAudits = audits.slice();
      try { return await operation(tx); } catch (error) { rows = before; audits = beforeAudits; throw error; }
    });
    queue = run.catch(() => {}); return run;
  };
  const storage: FinanceDocumentStorage = {
    mode: () => "local",
    put: async () => { puts++; if (failStore) throw Error("storage unavailable"); onPut(); },
    open: async () => { reads++; return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }); },
  };
  const service = createFinanceDocumentService({ transaction, storage });
  const input = { clientMutationId: randomUUID(), fileName: "Чек.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nreceipt") };
  return { service, input, users, get rows() { return rows; }, get audits() { return audits; }, get puts() { return puts; }, get reads() { return reads; },
    failStorage(value: boolean) { failStore = value; }, afterStorage(callback: () => void) { onPut = callback; } };
}

test("finance-only user can upload without a project; exact retry preserves document and audit", async () => {
  const f = fixture();
  const first = await f.service.upload("accountant", f.input);
  const repeated = await f.service.upload("accountant", f.input);
  assert.equal(first.document.id, repeated.document.id);
  assert.equal(repeated.repeated, true);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].state, "READY");
  assert.equal(f.audits.length, 1); assert.equal(f.puts, 1);
  assert.deepEqual(Object.keys(first.document).sort(), ["id", "fileName", "mimeType", "size", "createdAt", "source", "paymentId"].sort());
  assert.equal(first.document.source, "finance");
});

test("no finance rights denies before storage; revoked rights are checked on every call", async () => {
  const f = fixture();
  await assert.rejects(f.service.upload("manager", f.input), /прав/);
  assert.equal(f.puts, 0); assert.equal(f.rows.length, 0);
  const saved = await f.service.upload("accountant", f.input);
  f.users.get("accountant")!.roles = ["MANAGER"];
  await assert.rejects(f.service.read("accountant", saved.document.id), /прав/);
  assert.equal(f.reads, 0);
  f.users.get("manager")!.roles.push("PROCUREMENT");
  assert.ok(await f.service.upload("manager", { ...f.input, clientMutationId: randomUUID() }));
});

test("unbound documents remain private; posted document is visible to financial users", async () => {
  const f = fixture(), saved = await f.service.upload("accountant", f.input);
  assert.equal(await f.service.read("supply", saved.document.id), null);
  assert.equal(f.reads, 0);
  f.rows[0].payment = { id: "payment" };
  const read = await f.service.read("supply", saved.document.id);
  assert.equal(read?.document.paymentId, "payment"); assert.equal(f.reads, 1);
});

test("same mutation cannot change contents, metadata or owner", async () => {
  const f = fixture(); await f.service.upload("accountant", f.input);
  for (const input of [{ ...f.input, bytes: Buffer.from("other") }, { ...f.input, fileName: "Other.pdf" }])
    await assert.rejects(f.service.upload("accountant", input), /другими данными/);
  await assert.rejects(f.service.upload("supply", f.input), /другими данными/);
  assert.equal(f.puts, 1); assert.equal(f.audits.length, 1);
});

test("storage failure remains pending and unreadable, then same request recovers", async () => {
  const f = fixture(); f.failStorage(true);
  await assert.rejects(f.service.upload("accountant", f.input), /storage unavailable/);
  assert.equal(f.rows[0].state, "PENDING"); assert.equal(f.audits.length, 0);
  assert.equal(await f.service.read("accountant", f.rows[0].id), null);
  f.failStorage(false);
  const saved = await f.service.upload("accountant", f.input);
  assert.equal(saved.document.id, f.rows[0].id); assert.equal(f.audits.length, 1);
});

test("role revoked during transfer prevents confirmation and document use", async () => {
  const f = fixture();
  f.afterStorage(() => { f.users.get("accountant")!.active = false; });
  await assert.rejects(f.service.upload("accountant", f.input), /прав/);
  assert.equal(f.rows[0].state, "PENDING"); assert.equal(f.audits.length, 0);
});

test("empty file and malformed request are rejected without a reservation", async () => {
  const f = fixture();
  for (const input of [{ ...f.input, bytes: Buffer.alloc(0) }, { ...f.input, clientMutationId: "bad" }, { ...f.input, mimeType: "text/html\r\nX-Test: value" }])
    await assert.rejects(f.service.upload("accountant", input));
  assert.equal(f.rows.length, 0); assert.equal(f.puts, 0);
});
