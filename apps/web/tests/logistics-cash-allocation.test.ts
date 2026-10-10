import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateLogisticsMoney } from "../src/server/logistics/allocation";
import { createLogisticsPostingCore, logisticsPostingFingerprint, type LogisticsMoneyDependencies } from "../src/server/logistics/posting-core";
import { logisticsPostingSchema } from "../src/server/logistics/money-contracts";
import { prepareLogisticsPayment } from "../src/server/logistics/prepare-payment";
import { preparePayment } from "../src/server/payments/prepare";

test("one cash total is allocated exactly, including cents and shared saved FX", () => {
  const shares = [{ projectId: "a", percentBps: 4000 }, { projectId: "b", percentBps: 6000 }];
  const result = allocateLogisticsMoney("1000", shares, "1");
  assert.deepEqual(result.allocations.map(row => [row.amount, row.bynAmount]), [["400.00", "400.00"], ["600.00", "600.00"]]);
  assert.equal(result.bynAmount, "1000.00");
  assert.deepEqual(allocateLogisticsMoney("1200", shares, "1").allocations.map(row => row.amount), ["480.00", "720.00"]);
  const thirds = [{ projectId: "a", percentBps: 3333 }, { projectId: "b", percentBps: 3333 }, { projectId: "c", percentBps: 3334 }];
  assert.deepEqual(allocateLogisticsMoney("1.00", thirds, "1").allocations.map(row => row.amount), ["0.33", "0.33", "0.34"]);
  assert.deepEqual(allocateLogisticsMoney("0.01", shares, "1").allocations.map(row => row.amount), ["0.00", "0.01"]);
  const tie = allocateLogisticsMoney("0.01", [{ projectId: "b", percentBps: 5000 }, { projectId: "a", percentBps: 5000 }], "2.5");
  assert.deepEqual(tie.allocations.map(row => [row.projectId, row.amount]), [["a", "0.01"], ["b", "0.00"]]);
  const fx = allocateLogisticsMoney("0.02", [{ projectId: "a", percentBps: 5000 }, { projectId: "b", percentBps: 5000 }], "2.5");
  assert.equal(fx.bynAmount, "0.06"); // existing Payment rounds each 0.025 BYN to 0.03.
  assert.throws(() => allocateLogisticsMoney("1", [{ projectId: "a", percentBps: 9000 }], "1"), /100%/);
  assert.throws(() => allocateLogisticsMoney("1", [{ projectId: "a", percentBps: 5000 }, { projectId: "a", percentBps: 5000 }], "1"), /повтор/);
});

test("retry after an unknown outcome returns its saved snapshot without fetching FX or writing", async () => {
  const input = { tripId: "00000000-0000-4000-8000-000000000001", expectedRevision: 1,
    clientMutationId: "00000000-0000-4000-8000-000000000002", amount: "1000.00", currency: "USD",
    cashAccountId: "usd-cash", documentIds: ["00000000-0000-4000-8000-000000000003"] };
  const data = logisticsPostingSchema.parse(input);
  const actor = { id: "supplier", name: "Supplier", active: true, roles: ["PROCUREMENT"] };
  const fingerprint = logisticsPostingFingerprint(actor.id, "post", data);
  const dependencies = { db: {
    user: { async findUnique() { return actor; } },
    logisticsPosting: { async findUnique() { return { id: "saved-posting", tripId: input.tripId, tripRevision: 2, actorId: actor.id,
      requestFingerprint: fingerprint, status: "SUPERSEDED", allocations: [{ projectId: "a" }, { projectId: "b" }] }; } },
  }, async transaction() { assert.fail("retry must not enter a new money transaction"); },
  async getRate() { assert.fail("retry must not fetch a new exchange rate"); } } as unknown as LogisticsMoneyDependencies;
  assert.deepEqual(await createLogisticsPostingCore(actor.id, input, "post", dependencies), {
    tripId: input.tripId, revision: 2, postingId: "saved-posting", repeated: true, eventId: null, projectIds: ["a", "b"],
  });
  await assert.rejects(createLogisticsPostingCore(actor.id, { ...input, amount: "1200" }, "post", dependencies), /другими данными/);
  actor.roles = ["ACCOUNTANT"];
  await assert.rejects(createLogisticsPostingCore(actor.id, input, "post", dependencies), /Недостаточно прав/);
});

test("only internal logistics preparation can omit an expense article", async () => {
  const data = logisticsPostingSchema.parse({ tripId: "00000000-0000-4000-8000-000000000001", expectedRevision: 1,
    clientMutationId: "00000000-0000-4000-8000-000000000002", amount: "1000.00", currency: "BYN",
    cashAccountId: "cash", documentIds: ["00000000-0000-4000-8000-000000000003"] });
  const db = { cashAccount: { async findUnique() { return { id: "cash", name: "Cash", active: true, currency: "BYN" }; } } } as unknown as Parameters<typeof prepareLogisticsPayment>[2];
  const prepared = await prepareLogisticsPayment(data, "2026-10-10", db);
  assert.equal(prepared.articleId, null); assert.equal(prepared.project, null);
  assert.equal(prepared.amount, 1000); assert.equal(prepared.bynAmount, 1000); assert.equal(prepared.rate, 1);
  await assert.rejects(preparePayment({ direction: "EXPENSE", amount: 1000, currency: "BYN", cashAccountId: "cash" },
    db as unknown as Parameters<typeof preparePayment>[1]), /Выберите статью расхода/);
});
