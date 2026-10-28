import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getLogisticsTripCore } from "../src/server/logistics/query-core";
import { createLogisticsDocumentService } from "../src/server/logistics/documents";
import { canDeleteLogisticsTrip } from "../src/lib/logistics-access";

test("мягкое удаление разрешено только ADMIN", () => {
  assert.equal(canDeleteLogisticsTrip(["ADMIN"]), true);
  for (const role of ["DIRECTOR", "PROCUREMENT", "ACCOUNTANT", "MANAGER", "ENGINEER", "WORKER", "MOUNTER", "WORK_COORDINATOR"] as const)
    assert.equal(canDeleteLogisticsTrip([role]), false);
  assert.equal(canDeleteLogisticsTrip(["ACCOUNTANT", "PROCUREMENT"]), false);
  assert.equal(canDeleteLogisticsTrip(undefined), false);
});

test("удалённый рейс не открывается через прямое чтение", async () => {
  const row = { id: randomUUID(), date: new Date("2026-10-16"), comment: "", revision: 2, deletedAt: new Date(),
    shares: [], lines: [], documents: [] };
  const tx = { user: { findUnique: async () => ({ id: "admin", name: "Администратор", active: true, roles: ["ADMIN"] }) },
    logisticsTrip: { findUnique: async () => row } } as unknown as Prisma.TransactionClient;
  assert.equal(await getLogisticsTripCore("admin", row.id, async operation => operation(tx)), null);
});

test("загрузка удалённого рейса отклоняется до создания документа и записи в storage", async () => {
  const tripId = randomUUID(); let creates = 0, puts = 0;
  let saved: Record<string, unknown> | null = null;
  const tx = { $queryRaw: async () => [],
    user: { findUnique: async () => ({ id: "supplier", name: "Снабженец", active: true, roles: ["PROCUREMENT"] }) },
    logisticsTrip: { findUnique: async () => ({ id: tripId, deletedAt: new Date() }) },
    logisticsDocument: {
      findUnique: async () => saved,
      create: async ({ data }: { data: Record<string, unknown> }) => { creates++; saved = { ...data, createdAt: new Date() }; return saved; },
      update: async () => ({ ...saved, state: "READY" }),
    }, changeLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const service = createLogisticsDocumentService({ transaction: async operation => operation(tx), storage: {
    mode: () => "local", put: async () => { puts++; }, open: async () => null,
  } });
  await assert.rejects(service.upload("supplier", { tripId, clientMutationId: randomUUID(), stage: "ISSUED", fileName: "ТТН.pdf",
    mimeType: "application/pdf", bytes: Buffer.from("%PDF") }), /Рейс не найден/);
  assert.equal(creates, 0); assert.equal(puts, 0);
});
