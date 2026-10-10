import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { logisticsTripCreateSchema, logisticsDocumentUploadSchema } from "../src/server/logistics/contracts";
import { canManageLogistics, canReadLogisticsDocuments } from "../src/lib/logistics-access";

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
