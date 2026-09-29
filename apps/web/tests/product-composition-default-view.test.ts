import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { getProductCompositionFor } from "../src/server/composition/queries";
import { fixtureModel } from "./helpers/visibility-fixture";

test("current confirmed revision is default even when a newer draft exists", async () => {
  const now = new Date("2026-09-29T00:00:00Z");
  const db = {
    task: fixtureModel([]),
    product: fixtureModel([{ id: "product", number: "P-1", engineerId: null, status: "DESIGN" }]),
    productCompositionRevision: fixtureModel([
      { id: "draft", productId: "product", status: "DRAFT", revisionNo: null, draftVersion: 0,
        baseRevisionId: "confirmed", createdAt: now, createdById: "manager", confirmedAt: null, confirmedById: null },
      { id: "confirmed", productId: "product", status: "CONFIRMED", revisionNo: 1, draftVersion: 2,
        baseRevisionId: null, createdAt: now, createdById: "manager", confirmedAt: now, confirmedById: "manager" },
    ]),
    productCompositionItem: fixtureModel([
      { id: "draft-item", revisionId: "draft", lineageId: "same", parentId: null, kind: "PART", designation: "D-2",
        title: "Draft", quantityPerParent: 3, travelsToInstallation: false, createdAt: now, updatedAt: now },
      { id: "confirmed-item", revisionId: "confirmed", lineageId: "same", parentId: null, kind: "PART", designation: "D-1",
        title: "Confirmed", quantityPerParent: 2, travelsToInstallation: false, createdAt: now, updatedAt: now },
    ]),
    productCompositionFinish: fixtureModel([]),
  } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", roles: ["MANAGER" as const] };
  const defaultView = await getProductCompositionFor(db, actor, "product");
  assert.equal(defaultView?.selected?.id, "confirmed");
  assert.deepEqual(defaultView?.items.map((row) => row.id), ["confirmed-item"]);
  const draftView = await getProductCompositionFor(db, actor, "product", "draft");
  assert.equal(draftView?.selected?.id, "draft");
  assert.deepEqual(draftView?.items.map((row) => row.id), ["draft-item"]);
});
