import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { configureProductPercentageCore, transferProductPercentageCore, setProductNoModelCore } from "../src/server/product-percentage-pay/core";
import { patchProductPercentageCore } from "../src/server/product-percentage-pay/patch-core";
import type { ProductPercentagePatch } from "../src/server/product-percentage-pay/contracts";

test("retired percentage configuration/transfer and NoModel refuse before any data access", async () => {
  const actor = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
  const tx = new Proxy({}, { get() { throw Error("UNEXPECTED_DATABASE_ACCESS"); } }) as Prisma.TransactionClient;
  await assert.rejects(configureProductPercentageCore(actor, { productId: "p", kind: "ENGINEERING", ratePercent: "5", expectedRevision: 0, participants: [] }, tx), /одиночное поле/);
  await assert.rejects(transferProductPercentageCore(actor, { productId: "p", kind: "ENGINEERING", toUserId: "b", percentOfOwnShare: "10", expectedRevision: 0 }, tx), /больше недоступна/);
  await assert.rejects(setProductNoModelCore(actor, "p", true, tx), /больше не используется/);
  const input: ProductPercentagePatch = { productId: "p", kind: "ENGINEERING", field: "ratePercent", value: "5", expectedValue: null, expectedRevision: 0, clientMutationId: "00000000-0000-4000-8000-000000000001" };
  assert.equal((await patchProductPercentageCore({ ...actor, roles: ["ENGINEER"] }, input, tx)).kind, "forbidden");
  assert.equal((await patchProductPercentageCore(actor, { ...input, field: "workReview", value: [] } as unknown as ProductPercentagePatch, tx)).kind, "validation");
});
