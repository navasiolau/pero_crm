import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { LogisticsDocument, Prisma, Role } from "@prisma/client";
import { logisticsTripCreateSchema, logisticsDocumentUploadSchema } from "../src/server/logistics/contracts";
import { canManageLogistics, canReadLogisticsDocuments } from "../src/lib/logistics-access";
import { createLogisticsDocumentService } from "../src/server/logistics/documents";
import { requireLogisticsActor } from "../src/server/logistics/core";
import { uploadLogisticsDocumentResponse } from "../src/server/logistics/http";
import { multipartRequest } from "./helpers/multipart-request";

const manifest = () => ({ clientMutationId: randomUUID(), date: "2026-10-10",
  shares: [{ projectId: "a", percentBps: 4000 }, { projectId: "b", percentBps: 6000 }],
  lines: [{ projectId: "a", kind: "PRODUCT" as const, productId: "p-a", quantity: 2 },
    { projectId: "b", kind: "MATERIAL" as const, materialId: "m-b", quantity: 3.125 }] });

test("одна отгрузка сохраняет ручные 40/60; один проект получает 100%", () => {
  assert.deepEqual(logisticsTripCreateSchema.parse(manifest()).shares.map(row => row.percentBps), [4000, 6000]);
  const one = manifest();
  assert.equal(logisticsTripCreateSchema.parse({ ...one, shares: [{ projectId: "a" }], lines: one.lines.slice(0, 1) }).shares[0].percentBps, 10000);
});

test("неполные/повторные доли, чужой проект строки и нецелое изделие отклоняются", () => {
  const valid = manifest();
  for (const input of [
    { ...valid, shares: [valid.shares[0], { projectId: "b", percentBps: 5000 }] },
    { ...valid, shares: [{ projectId: "a", percentBps: 5000 }, { projectId: "a", percentBps: 5000 }] },
    { ...valid, lines: [{ ...valid.lines[0], projectId: "c" }, valid.lines[1]] },
    { ...valid, lines: [{ ...valid.lines[0], quantity: 1.5 }, valid.lines[1]] },
    { ...valid, date: "2026-02-30" },
  ]) assert.equal(logisticsTripCreateSchema.safeParse(input).success, false);
});

test("роль снабженца управляет, бухгалтер читает; объединение не раскрывает чистые роли", () => {
  for (const role of ["ADMIN", "DIRECTOR", "PROCUREMENT"] as const) assert.equal(canManageLogistics([role]), true);
  for (const role of ["MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as const) {
    assert.equal(canManageLogistics([role]), false); assert.equal(canReadLogisticsDocuments([role]), false);
  }
  assert.equal(canManageLogistics(["ACCOUNTANT"]), false); assert.equal(canReadLogisticsDocuments(["ACCOUNTANT"]), true);
  assert.equal(canManageLogistics(["MANAGER", "PROCUREMENT"]), true);
  assert.equal(canManageLogistics(["ACCOUNTANT", "PROCUREMENT"]), true);
});

test("стадия ТТН подтверждается явно; путь хранения не принимается клиентом", () => {
  const input = { tripId: randomUUID(), clientMutationId: randomUUID(), stage: "ISSUED", ttnNumber: "ТТН-1",
    fileName: "Накладная.pdf", mimeType: "application/pdf" };
  assert.equal(logisticsDocumentUploadSchema.parse(input).stage, "ISSUED");
  assert.equal(logisticsDocumentUploadSchema.safeParse({ ...input, stage: "UNKNOWN" }).success, false);
  assert.equal(logisticsDocumentUploadSchema.safeParse({ ...input, storageKey: "another-document" }).success, false);
});

test("HTTP ТТН передаёт поток: retry, две печати и отзыв роли сохраняют lifecycle без изменения рейса", async () => {
  const trip = { id: randomUUID(), revision: 7 }, actor = { id: "qa-procurement", name: "QA", active: true, roles: ["PROCUREMENT"] as Role[] };
  let rows: LogisticsDocument[] = [], audits: unknown[] = [], puts = 0, failStorage = true, revokeDuringStorage = false, pulls = 0;
  const tx = {
    $queryRaw: async () => [], user: { findUnique: async () => actor },
    logisticsTrip: { findUnique: async ({ where }: { where: { id: string } }) => where.id === trip.id ? trip : null,
      update: async () => { throw Error("TRIP_MUST_NOT_CHANGE"); } },
    logisticsDocument: {
      findUnique: async ({ where }: { where: { id?: string; clientMutationId?: string } }) => rows.find(row => where.id ? row.id === where.id : row.clientMutationId === where.clientMutationId) ?? null,
      create: async ({ data }: { data: LogisticsDocument }) => { const row = { ...data, createdAt: new Date(), readyAt: null }; rows.push(row); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<LogisticsDocument> }) => { const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return row; },
    }, changeLog: { create: async ({ data }: { data: unknown }) => { audits.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const service = createLogisticsDocumentService({ transaction: async operation => {
    const before = structuredClone(rows), oldAudits = audits.slice();
    try { return await operation(tx); } catch (error) { rows = before; audits = oldAudits; throw error; }
  }, storage: { mode: () => "local", put: async (row, content) => {
    puts++; if (failStorage) throw Error("STORE_UNAVAILABLE");
    assert.equal(Buffer.isBuffer(content), false); if (Buffer.isBuffer(content)) throw Error("FULL_DOCUMENT_BUFFER");
    const parts: Buffer[] = []; for await (const part of await content.openRead()) parts.push(Buffer.from(part));
    const bytes = Buffer.concat(parts); assert.equal(bytes.toString(), "%PDF"); assert.equal(row.size, bytes.length);
    assert.equal(row.contentHash, createHash("sha256").update(bytes).digest("hex"));
    if (revokeDuringStorage) actor.active = false;
  }, open: async () => null } });
  const mutation = randomUUID(), signed = randomUUID();
  const upload = (stage: "ISSUED" | "SIGNED", nonce: string, ttnNumber = "ТТН-140") => {
    const request = multipartRequest({ file: new File(["%PDF"], "Накладная.pdf", { type: "application/pdf" }),
      tripId: trip.id, stage, clientMutationId: nonce, ttnNumber }, { chunkBytes: 1, onPull: () => { pulls++; } });
    request.formData = async () => { throw Error("FULL_FORM_DATA"); }; request.arrayBuffer = async () => { throw Error("FULL_REQUEST_BUFFER"); };
    return uploadLogisticsDocumentResponse(request, { authorize: async () => (await requireLogisticsActor(actor.id, tx)).id, service });
  };
  actor.roles = ["MANAGER"]; assert.equal((await upload("ISSUED", mutation)).status, 403); assert.equal(pulls, 0); assert.equal(puts, 0);
  actor.roles = ["PROCUREMENT"]; assert.equal((await upload("ISSUED", mutation)).status, 500);
  assert.equal(rows.length, 1); assert.equal(rows[0].state, "PENDING"); assert.equal(audits.length, 0);
  failStorage = false; const first = await upload("ISSUED", mutation); assert.equal(first.status, 201); const id = (await first.json()).document.id;
  assert.equal((await upload("ISSUED", mutation)).status, 200); assert.equal(rows.length, 1); assert.equal(rows[0].id, id); assert.equal(puts, 2); assert.equal(audits.length, 1);
  assert.equal((await upload("ISSUED", mutation, "changed")).status, 409); assert.equal(puts, 2);
  revokeDuringStorage = true; assert.equal((await upload("SIGNED", signed)).status, 403); assert.equal(rows[1].state, "PENDING"); assert.equal(audits.length, 1);
  actor.active = true; revokeDuringStorage = false; assert.equal((await upload("SIGNED", signed)).status, 201);
  assert.deepEqual(rows.map(row => row.stage), ["ISSUED", "SIGNED"]); assert.ok(rows.every(row => row.state === "READY")); assert.equal(audits.length, 2); assert.equal(trip.revision, 7);
});
