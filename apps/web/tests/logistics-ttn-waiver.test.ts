import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { logisticsTripCreateSchema, logisticsTripUpdateSchema } from "../src/server/logistics/contracts";
import { logisticsPostingSchema } from "../src/server/logistics/money-contracts";
import { assertLogisticsPaymentContext } from "../src/server/logistics/payment-context";
import { createLogisticsTripCore, updateLogisticsTripCore } from "../src/server/logistics/core";
import { createLogisticsPostingCore, type LogisticsMoneyDependencies } from "../src/server/logistics/posting-core";

const manifest = { date: "2026-10-29", shares: [{ projectId: "p", percentBps: 10000 }],
  lines: [{ kind: "PRODUCT" as const, projectId: "p", productId: "product", quantity: 1 }] };

test("повтор create/update до появления галочки находит прежний receipt без записей", async () => {
  const actorId = "supplier", tripId = randomUUID();
  for (const operation of ["create", "update"] as const) {
    // Порядок полей нормализован прежней Zod-схемой и входит в сохранённый SHA256.
    const oldData = { clientMutationId: randomUUID(), date: manifest.date, comment: "",
      lines: manifest.lines.map(({ projectId, kind, productId, quantity }) => ({ projectId, kind, productId, quantity })),
      ...(operation === "update" ? { tripId, expectedRevision: 1 } : {}), shares: manifest.shares };
    const fingerprint = createHash("sha256").update(JSON.stringify({ actorId, operation, ...oldData })).digest("hex");
    const tx = { $queryRaw: async () => [], user: { findUnique: async () => ({ id: actorId, name: "Снабженец", active: true, roles: ["PROCUREMENT"] }) },
      logisticsMutation: { findUnique: async () => ({ actorId, tripId, revision: 1, requestFingerprint: fingerprint }) },
      logisticsTrip: { create: async () => { throw Error("LEGACY_REPLAY_MUST_NOT_CREATE"); }, updateMany: async () => { throw Error("LEGACY_REPLAY_MUST_NOT_UPDATE"); } },
    } as unknown as Prisma.TransactionClient;
    const replay = await (operation === "create" ? createLogisticsTripCore : updateLogisticsTripCore)(actorId, oldData, async action => action(tx));
    assert.deepEqual(replay, { tripId, revision: 1, repeated: true });
  }
});

test("повтор денежного запроса прежней версии сохраняет прежний порядок manifest и не запрашивает курс", async () => {
  const actorId = "supplier", tripId = randomUUID(), postingId = randomUUID();
  const oldManifest = { date: manifest.date, comment: "", shares: manifest.shares,
    lines: manifest.lines.map(({ projectId, kind, productId, quantity }) => ({ projectId, kind, productId, quantity })) };
  for (const mode of ["post", "correct"] as const) {
    const input = { tripId, expectedRevision: 1, clientMutationId: randomUUID(), amount: "10.00", currency: "BYN", cashAccountId: "cash",
      documentIds: [randomUUID()], manifest: oldManifest };
    const fingerprint = createHash("sha256").update(JSON.stringify({ actorId, mode, tripId, expectedRevision: 1, amount: "10.00", currency: "BYN",
      cashAccountId: "cash", documentIds: input.documentIds, rate: null, rateDate: null, manifest: oldManifest })).digest("hex");
    const dependencies = { db: { user: { findUnique: async () => ({ id: actorId, name: "Снабженец", active: true, roles: ["PROCUREMENT"] }) },
      logisticsPosting: { findUnique: async () => ({ id: postingId, tripId, tripRevision: 2, actorId, requestFingerprint: fingerprint, allocations: [{ projectId: "p" }] }) } },
      transaction: async () => { throw Error("LEGACY_PAYMENT_REPLAY_MUST_NOT_WRITE"); }, getRate: async () => { throw Error("LEGACY_PAYMENT_REPLAY_MUST_NOT_FETCH_RATE"); },
    } as unknown as LogisticsMoneyDependencies;
    const replay = await createLogisticsPostingCore(actorId, input, mode, dependencies);
    assert.equal(replay.repeated, true); assert.equal(replay.postingId, postingId);
  }
});

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
