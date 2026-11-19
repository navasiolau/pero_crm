import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinanceDocument, Prisma } from "@prisma/client";
import { createFinanceDocumentService } from "../src/server/finance-documents/core";
import { financeDocumentUploadReversal } from "../src/server/finance-documents/upload-reversal";

const actor = { id: "admin", name: "Администратор", roles: ["ADMIN" as const], source: "web" as const };
const input = { clientMutationId: "10bb61ff-afe3-41ff-8acf-72beeea9d796",
  fileName: "receipt.pdf", mimeType: "application/pdf", bytes: Buffer.from("receipt") };

test("READY upload is reversible, retaining content, and original retry cannot resurrect it", async () => {
  type Row = FinanceDocument & { payment: null | { id: string }; paymentReport: null | { paymentId: string } };
  const documents: Row[] = [];
  let stored = Buffer.alloc(0);
  let writes = 0;
  const audits: { reversal: { data: unknown } }[] = [];
  const tx = {
    $queryRaw: async () => [],
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ ...actor, active: where.id === actor.id }) },
    changeLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return data; } },
    financeDocument: {
      create: async ({ data }: { data: FinanceDocument }) => {
        const row = { ...data, createdAt: new Date(), visibilityRevision: 0, payment: null, paymentReport: null };
        documents.push(row);
        return row;
      },
      findUnique: async () => documents[0] ?? null,
      update: async ({ data }: { data: { state: Row["state"]; visibilityRevision?: { increment: number } } }) => {
        const row = documents[0]!;
        row.state = data.state;
        row.visibilityRevision += data.visibilityRevision?.increment ?? 0;
        return row;
      },
      count: async () => documents.filter(({ state }) => state === "READY").length,
      findMany: async () => documents.filter(({ state }) => state === "READY"),
    },
  } as unknown as Prisma.TransactionClient;
  const service = createFinanceDocumentService({
    transaction: operation => operation(tx),
    storage: {
      mode: () => "local",
      put: async (_row, bytes) => { assert.ok(Buffer.isBuffer(bytes)); stored = Buffer.from(bytes); writes++; },
      open: async () => new ReadableStream({ start(controller) { controller.enqueue(stored); controller.close(); } }),
    },
  });
  await assert.rejects(() => service.upload("other", input), /Недостаточно прав/);
  const uploaded = await service.upload(actor.id, input);
  const original = financeDocumentUploadReversal.read(audits[0]?.reversal.data)!;
  const ctx = { tx, entityId: uploaded.document.id, actor, entryId: "entry" };
  assert.equal((await service.upload(actor.id, input)).repeated, true);
  assert.equal((await service.list(actor.id)).total, 1);
  assert.ok(await service.read(actor.id, uploaded.document.id));
  documents[0]!.paymentReport = { paymentId: "active-payment" };
  await assert.rejects(() => original.apply(ctx), /действующим платежом/);
  documents[0]!.paymentReport = null;
  const reversed = await original.apply(ctx);
  assert.equal((await service.list(actor.id)).total, 0);
  assert.equal(await service.read(actor.id, uploaded.document.id), null);
  await assert.rejects(() => service.upload(actor.id, input), /отменена в журнале/);
  await assert.rejects(() => original.apply(ctx), /изменился/);
  await financeDocumentUploadReversal.read(reversed.reversal.data)!.apply(ctx);
  const restored = await service.read(actor.id, uploaded.document.id);
  assert.ok(restored);
  assert.deepEqual(Buffer.from((await restored.body.getReader().read()).value!), input.bytes);
  assert.equal(writes, 1);
});
