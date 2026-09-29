import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { getProductCompositionFor } from "../src/server/composition/queries";
import { engineerFixture, fixtureModel } from "./helpers/visibility-fixture";

function db() {
  const fixture = engineerFixture();
  const now = new Date("2026-09-29T00:00:00Z");
  Object.assign(fixture.db, {
    productCompositionRevision: fixtureModel([
      { id: "own-revision", productId: "own", status: "CONFIRMED", revisionNo: 1, baseRevisionId: null,
        draftVersion: 1, createdAt: now, createdById: "manager", confirmedAt: now, confirmedById: "manager" },
      { id: "foreign-revision", productId: "foreign", status: "CONFIRMED", revisionNo: 1, baseRevisionId: null,
        draftVersion: 1, createdAt: now, createdById: "manager", confirmedAt: now, confirmedById: "manager" },
    ]),
    productCompositionItem: fixtureModel([
      { id: "own-item", revisionId: "own-revision", lineageId: "lineage", parentId: null, kind: "PART",
        designation: "Д-1", title: "Деталь", quantityPerParent: 2, travelsToInstallation: true,
        sortOrder: 0, createdAt: now, updatedAt: now },
      { id: "foreign-item", revisionId: "foreign-revision", lineageId: "other-lineage", parentId: null, kind: "PART",
        designation: "Секрет", title: "Секрет", quantityPerParent: 3, travelsToInstallation: false,
        sortOrder: 0, createdAt: now, updatedAt: now },
    ]),
  });
  return fixture;
}

test("engineer sees own DESIGN revision but direct foreign revision ID reveals nothing", async () => {
  const fixture = db();
  const actor = { id: "engineer", roles: ["ENGINEER" as Role] };
  const own = await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, actor, "own");
  assert.deepEqual(own?.items.map((row) => row.id), ["own-item"]);
  assert.equal(await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, actor, "foreign"), null);
  assert.equal(await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, actor, "own", "foreign-revision"), null);
  fixture.products.find((row) => row.id === "own")!.status = "PRODUCTION";
  assert.equal(await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, actor, "own"), null);
});

test("manager keeps independent visibility; field role only reads an already visible product", async () => {
  const fixture = db();
  const manager = { id: "manager", roles: ["MANAGER" as Role] };
  assert.deepEqual((await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, manager, "foreign"))?.items.map((row) => row.id), ["foreign-item"]);
  const accountantEngineer = { id: "engineer", roles: ["ACCOUNTANT", "ENGINEER"] as Role[] };
  assert.deepEqual((await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, accountantEngineer, "foreign"))?.items.map((row) => row.id), ["foreign-item"]);
  const field = { id: "engineer", roles: ["WORKER" as Role] };
  assert.deepEqual((await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, field, "own"))?.items.map((row) => row.id), ["own-item"]);
  assert.equal(await getProductCompositionFor(fixture.db as unknown as Prisma.TransactionClient, field, "hidden-product"), null);
});
