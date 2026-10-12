import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { createFinanceDocumentService, type FinanceDocumentStorage } from "../src/server/finance-documents/core";

process.loadEnvFile(".env");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5433" && url.pathname === "/pero_crm", "LOCAL_TARGET_GUARD");
const db = new PrismaClient();
const runId = randomUUID(), userIds = [0, 1, 2].map(index => `qa-finance97-${runId}-${index}`);
const marker = `qa-finance97-${runId}`;
let paymentId: string | undefined;
const bytes = new Map<string, Buffer>();
let failStorage = false, loads = 0;
const storage: FinanceDocumentStorage = {
  mode: () => "local",
  async put(row, content) { if (failStorage) throw Error("TEST_STORAGE_FAILURE"); assert.ok(Buffer.isBuffer(content), "LEGACY_NATIVE_BUFFER_FIXTURE"); bytes.set(row.storageKey, Buffer.from(content)); },
  async open(row) { loads++; const content = bytes.get(row.storageKey); return content ? new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }) : null; },
};
const service = createFinanceDocumentService({ storage, transaction: operation => db.$transaction(operation, { maxWait: 10_000, timeout: 15_000 }) });
async function baseline() {
  const result: Record<string, unknown> = {};
  for (const table of ["User", "Payment", "File", "FinanceDocument"])
    result[table] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) AS digest FROM "${table}" t`);
  return result;
}
async function main() {
const before = await baseline();
try {
  assert.deepEqual(await db.$queryRaw`SELECT current_database() AS name`, [{ name: "pero_crm" }]);
  for (const [index, role] of (["ACCOUNTANT", "PROCUREMENT", "MANAGER"] as Role[]).entries())
    await db.user.create({ data: { id: userIds[index], name: marker, email: `${marker}-${index}@invalid.local`, passwordHash: "qa-login-disabled", roles: [role] } });
  const input = { clientMutationId: randomUUID(), fileName: "Отчёт.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nfinance97") };
  const uploads = await Promise.all(Array.from({ length: 4 }, () => service.upload(userIds[0], input)));
  assert.equal(new Set(uploads.map(row => row.document.id)).size, 1);
  const documentId = uploads[0].document.id;
  assert.equal(await db.financeDocument.count({ where: { uploadedById: userIds[0] } }), 1);
  assert.equal(await db.changeLog.count({ where: { entity: "financeDocument", entityId: documentId } }), 1);
  await assert.rejects(service.upload(userIds[0], { ...input, bytes: Buffer.from("changed") }), /другими данными/);
  await assert.rejects(service.upload(userIds[2], input), /прав/);
  assert.equal(await service.read(userIds[1], documentId), null); assert.equal(loads, 0);
  assert.ok(await service.read(userIds[0], documentId));
  paymentId = randomUUID();
  await db.payment.create({ data: { id: paymentId, direction: "INCOME", amount: 0, currency: "BYN", rate: 1, bynAmount: 0,
    createdById: userIds[0], comment: marker, reportDocumentId: documentId } });
  assert.ok(await service.read(userIds[1], documentId));
  await assert.rejects(db.financeDocument.delete({ where: { id: documentId } }));
  const listed = await service.list(userIds[1], { query: "Отчёт" });
  assert.ok(listed.rows.some(row => row.id === documentId));
  await db.user.update({ where: { id: userIds[0] }, data: { roles: ["MANAGER"] } });
  await assert.rejects(service.read(userIds[0], documentId), /прав/);
  await db.user.update({ where: { id: userIds[0] }, data: { roles: ["ACCOUNTANT"] } });
  failStorage = true;
  const pending = { ...input, clientMutationId: randomUUID() };
  await assert.rejects(service.upload(userIds[0], pending), /TEST_STORAGE_FAILURE/);
  const reservation = await db.financeDocument.findUniqueOrThrow({ where: { clientMutationId: pending.clientMutationId } });
  assert.equal(reservation.state, "PENDING"); assert.equal(await service.read(userIds[0], reservation.id), null);
  failStorage = false; assert.equal((await service.upload(userIds[0], pending)).document.id, reservation.id);
  console.log("NATIVE97: concurrency, replay, roles, private drafts, posted read, FK retention, pending recovery PASS");
} finally {
  await db.$transaction(async tx => {
    if (paymentId) await tx.payment.deleteMany({ where: { id: paymentId, comment: marker } });
    await tx.changeLog.deleteMany({ where: { actorId: { in: userIds }, entity: "financeDocument" } });
    await tx.financeDocument.deleteMany({ where: { uploadedById: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds }, name: marker } });
  });
  assert.deepEqual(await baseline(), before, "ORIGINAL_DATA_CHANGED");
  console.log("NATIVE97: exact QA cleanup and User/Payment/File/FinanceDocument baseline MATCH");
  await db.$disconnect();
}
}
void main().catch(async error => { console.error(error); await db.$disconnect(); process.exitCode = 1; });
