import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { logisticsTripCreateSchema, logisticsTripUpdateSchema } from "../src/server/logistics/contracts";
import { logisticsPostingSchema } from "../src/server/logistics/money-contracts";
import { assertLogisticsPaymentContext } from "../src/server/logistics/payment-context";

const manifest = { date: "2026-10-29", shares: [{ projectId: "p", percentBps: 10000 }],
  lines: [{ kind: "PRODUCT" as const, projectId: "p", productId: "product", quantity: 1 }] };

test("галочка по умолчанию выключена, а пропуск при редактировании сохраняется для разрешения сервером", () => {
  const create = { ...manifest, clientMutationId: randomUUID() };
  assert.equal(logisticsTripCreateSchema.parse(create).ttnNotRequired, false);
  assert.equal(logisticsTripCreateSchema.parse({ ...create, ttnNotRequired: true }).ttnNotRequired, true);
  const update = { ...create, tripId: randomUUID(), expectedRevision: 1 };
  assert.equal(logisticsTripUpdateSchema.parse(update).ttnNotRequired, undefined);
  assert.equal(logisticsTripUpdateSchema.parse({ ...update, ttnNotRequired: false }).ttnNotRequired, false);
  const posting = logisticsPostingSchema.parse({ tripId: update.tripId, expectedRevision: 1, clientMutationId: randomUUID(),
    amount: "10.00", currency: "BYN", cashAccountId: "cash", documentIds: [], manifest: { ...manifest, ttnNotRequired: true } });
  assert.equal(posting.manifest?.ttnNotRequired, true);
  assert.deepEqual(posting.documentIds, []);
});

test("внутренний Payment разрешает пустой комплект только по снимку проведения, но проверяет каждый переданный файл", async () => {
  const { Prisma } = await import("@prisma/client");
  const actor = { id: "actor", name: "Снабженец", roles: ["PROCUREMENT"] as const, source: "web" as const };
  const amount = new Prisma.Decimal(10), rate = new Prisma.Decimal(1), paidAt = new Date("2026-10-29T00:00:00Z");
  const posting = { status: "ACTIVE", actorId: actor.id, tripId: "trip", trip: { deletedAt: null }, ttnNotRequired: true, currency: "BYN",
    cashAccountId: "cash", expenseArticleId: null, rate, rateDate: null, paidAt,
    documents: [] as { document: { tripId: string; state: string; stage: string } }[] };
  const allocation = { id: "allocation", projectId: "p", payment: null, amount, bynAmount: amount, posting };
  const tx = { user: { findUnique: async () => ({ ...actor, roles: [...actor.roles], active: true }) },
    logisticsPostingAllocation: { findUnique: async () => allocation } } as unknown as Prisma.TransactionClient;
  const data = { direction: "EXPENSE" as const, amount: 10, currency: "BYN" as const, cashAccountId: "cash", projectId: "p" };
  const prepared = { project: { id: "p" }, account: { id: "cash" }, articleId: null, amount: 10, bynAmount: 10, rate: 1,
    rateDate: null, paidAt } as Parameters<typeof assertLogisticsPaymentContext>[2];
  const domainActor = { ...actor, roles: [...actor.roles] };
  assert.equal(await assertLogisticsPaymentContext(domainActor, data, prepared, tx, allocation.id), allocation.id);
  posting.ttnNotRequired = false;
  await assert.rejects(assertLogisticsPaymentContext(domainActor, data, prepared, tx, allocation.id), /ТТН/);
  posting.ttnNotRequired = true;
  for (const document of [{ tripId: "other", state: "READY", stage: "ISSUED" }, { tripId: "trip", state: "PENDING", stage: "ISSUED" }]) {
    posting.documents = [{ document }];
    await assert.rejects(assertLogisticsPaymentContext(domainActor, data, prepared, tx, allocation.id), /ТТН/);
  }
});
