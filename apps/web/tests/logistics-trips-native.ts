import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createLogisticsTripCore, updateLogisticsTripCore, type LogisticsTransaction } from "../src/server/logistics/core";
import { createLogisticsDocumentService, type LogisticsDocumentStorage } from "../src/server/logistics/documents";
import { getLogisticsOptionsCore, getLogisticsTripCore, listLogisticsTripsCore } from "../src/server/logistics/query-core";
import { readLogisticsDocumentResponse } from "../src/server/logistics/http";

if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5433" && url.pathname === "/pero_crm", "LOCAL_TARGET_GUARD");
const db = new PrismaClient(), rollback = new Error("QA123_ROLLBACK");

async function expectDatabaseReject(tx: Prisma.TransactionClient, operation: () => Promise<unknown>) {
  await tx.$executeRawUnsafe("SAVEPOINT qa123_constraint");
  let failed = false;
  try { await operation(); } catch { failed = true; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa123_constraint");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa123_constraint");
  assert.ok(failed, "DATABASE_CONSTRAINT_MUST_REJECT");
}

async function main() {
  let passed = false;
  try {
    await db.$transaction(async tx => {
      assert.deepEqual(await tx.$queryRaw`SELECT current_database() AS name`, [{ name: "pero_crm" }]);
      const products = await tx.product.findMany({ where: { deletedAt: null, status: { not: "DRAFT" }, project: { deletedAt: null } },
        select: { id: true, projectId: true }, orderBy: { id: "asc" } });
      const a = products[0], b = products.find(row => row.projectId !== a?.projectId);
      assert.ok(a && b, "EXISTING_TWO_PROJECTS_REQUIRED");
      const marker = `qa123-${randomUUID()}`, actors = ["PROCUREMENT", "ACCOUNTANT", "MANAGER"] as const;
      const actorIds = actors.map(() => randomUUID());
      for (let index = 0; index < actors.length; index++) await tx.user.create({ data: { id: actorIds[index], name: marker,
        email: `${marker}-${index}@invalid.local`, passwordHash: "qa-login-disabled", roles: [actors[index]] } });
      const transaction: LogisticsTransaction = operation => operation(tx);
      const before = { stock: await tx.stockMovement.count(), files: await tx.file.count(), payments: await tx.payment.count() };
      const draft = await tx.product.findFirst({ where: { status: "DRAFT", deletedAt: null, project: { deletedAt: null } }, select: { id: true, projectId: true } });
      if (draft) {
        const draftInput = { clientMutationId: randomUUID(), date: "2026-10-10", shares: [{ projectId: draft.projectId }],
          lines: [{ projectId: draft.projectId, kind: "PRODUCT", productId: draft.id, quantity: 1 }] };
        await assert.rejects(createLogisticsTripCore(actorIds[0], draftInput, transaction), /не принадлежит/);
        assert.equal((await getLogisticsOptionsCore(actorIds[0], transaction)).projects.some(project => project.products.some(product => product.id === draft.id)), false);
        await tx.user.update({ where: { id: actorIds[0] }, data: { roles: ["ADMIN"] } });
        assert.ok(await createLogisticsTripCore(actorIds[0], { ...draftInput, clientMutationId: randomUUID() }, transaction));
        assert.equal((await getLogisticsOptionsCore(actorIds[0], transaction)).projects.some(project => project.products.some(product => product.id === draft.id)), true);
        await tx.user.update({ where: { id: actorIds[0] }, data: { roles: ["PROCUREMENT"] } });
      }
      const input = { clientMutationId: randomUUID(), date: "2026-10-10", comment: marker,
        shares: [{ projectId: a.projectId, percentBps: 4000 }, { projectId: b.projectId, percentBps: 6000 }],
        lines: [{ projectId: a.projectId, kind: "PRODUCT", productId: a.id, quantity: 2 },
          { projectId: b.projectId, kind: "PRODUCT", productId: b.id, quantity: 3 }] };
      const created = await createLogisticsTripCore(actorIds[0], input, transaction);
      assert.equal((await createLogisticsTripCore(actorIds[0], input, transaction)).tripId, created.tripId);
      assert.equal(await tx.logisticsTrip.count({ where: { id: created.tripId } }), 1);
      await assert.rejects(createLogisticsTripCore(actorIds[0], { ...input, clientMutationId: randomUUID(),
        shares: [input.shares[0], { ...input.shares[1], percentBps: 5000 }] }, transaction), /100%/);
      await assert.rejects(createLogisticsTripCore(actorIds[0], { ...input, clientMutationId: randomUUID(),
        lines: [{ ...input.lines[0], productId: b.id }, input.lines[1]] }, transaction), /не принадлежит/);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
      const shares = await tx.logisticsProjectShare.findMany({ where: { tripId: created.tripId }, orderBy: { projectId: "asc" } });
      await expectDatabaseReject(tx, () => tx.logisticsProjectShare.create({ data: { tripId: created.tripId, projectId: a.projectId, percentBps: 1 } }));
      await expectDatabaseReject(tx, () => tx.logisticsProjectShare.create({ data: { tripId: created.tripId, projectId: randomUUID(), percentBps: 1 } }));
      await expectDatabaseReject(tx, async () => {
        await tx.logisticsProjectShare.update({ where: { id: shares[0].id }, data: { percentBps: 1 } });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      });
      const update = { ...input, clientMutationId: randomUUID(), tripId: created.tripId, expectedRevision: created.revision, comment: `${marker}-edited` };
      assert.equal((await updateLogisticsTripCore(actorIds[0], update, transaction)).revision, 2);
      assert.deepEqual((await tx.logisticsProjectShare.findMany({ where: { tripId: created.tripId }, orderBy: { projectId: "asc" } })).map(row => row.id), shares.map(row => row.id));
      assert.equal((await updateLogisticsTripCore(actorIds[0], update, transaction)).repeated, true);
      await assert.rejects(updateLogisticsTripCore(actorIds[0], { ...update, clientMutationId: randomUUID() }, transaction), /уже изменён/);
      let failStorage = true;
      const bytes = new Map<string, Buffer>();
      const storage: LogisticsDocumentStorage = { mode: () => "local", async put(row, content) {
        if (failStorage) throw Error("TEST_STORAGE_FAILURE"); bytes.set(row.storageKey, Buffer.from(content));
      }, async open(row) { const content = bytes.get(row.storageKey); return content ? new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }) : null; } };
      const service = createLogisticsDocumentService({ transaction, storage });
      const document = { tripId: created.tripId, clientMutationId: randomUUID(), stage: "ISSUED" as const,
        ttnNumber: marker, fileName: "ТТН.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nqa123") };
      await assert.rejects(service.upload(actorIds[0], document), /TEST_STORAGE_FAILURE/);
      const pending = await tx.logisticsDocument.findUniqueOrThrow({ where: { clientMutationId: document.clientMutationId } });
      assert.equal(pending.state, "PENDING"); assert.equal(await service.read(actorIds[1], pending.id), null);
      failStorage = false;
      const ready = await service.upload(actorIds[0], document);
      assert.equal(ready.document.id, pending.id); assert.equal((await service.upload(actorIds[0], document)).repeated, true);
      await assert.rejects(service.upload(actorIds[1], { ...document, clientMutationId: randomUUID() }), /прав/);
      const downloaded = await readLogisticsDocumentResponse(new Request("http://localhost/api/logistics/documents/id?view=1"), pending.id,
        { authorize: async () => actorIds[1], service });
      assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), document.bytes);
      assert.equal((await readLogisticsDocumentResponse(new Request("http://localhost/api/logistics/documents/id"), pending.id,
        { authorize: async () => actorIds[2], service })).status, 403);
      const signed = await service.upload(actorIds[0], { ...document, clientMutationId: randomUUID(), stage: "SIGNED", bytes: Buffer.from("%PDF-1.4\nsigned") });
      assert.notEqual(signed.document.id, ready.document.id); assert.equal((await service.list(actorIds[1], created.tripId)).length, 2);
      assert.equal((await tx.logisticsTrip.findUniqueOrThrow({ where: { id: created.tripId } })).revision, 2);
      const accountant = await getLogisticsTripCore(actorIds[1], created.tripId, transaction);
      assert.equal(accountant?.mode, "documents"); assert.equal("lines" in accountant!, false); assert.equal("comment" in accountant!, false);
      for (const projectId of [a.projectId, b.projectId]) assert.ok((await listLogisticsTripsCore(actorIds[0], { projectId, query: marker }, transaction)).rows.some(row => row.id === created.tripId));
      await assert.rejects(getLogisticsTripCore(actorIds[2], created.tripId, transaction), /прав/);
      await tx.user.update({ where: { id: actorIds[0] }, data: { roles: ["MANAGER"] } });
      await assert.rejects(service.read(actorIds[0], pending.id), /прав/);
      assert.deepEqual({ stock: await tx.stockMovement.count(), files: await tx.file.count(), payments: await tx.payment.count() }, before);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      passed = true;
      throw rollback;
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.ok(passed);
  console.log("QA123 PASS: shared40/60, replay/CAS, PostgreSQL constraints, pending retry, private TTN, two stamps; all DB QA rolled back, no disk files/payment/stock writes");
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "QA123 failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
