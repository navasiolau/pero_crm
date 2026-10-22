import { test } from "node:test";
import assert from "node:assert/strict";
import { fileVisibilityWhere } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

test("retired managed copy is hidden, while a live manual or cover-referenced File retains ordinary ACL", () => {
  const project: FixtureRow = { id: "project", stage: "CONTRACT", deletedAt: null, products: [], tasks: [] };
  const product: FixtureRow = { id: "product", project, projectId: "project", deletedAt: null, status: "DESIGN", engineerId: "engineer", tasks: [] };
  project.products = [product];
  const file: FixtureRow = { id: "file", section: "GENERAL", project, projectId: "project", product, productId: "product", taskId: null, task: null,
    proposalMediaRetiredAt: null, sketchForProduct: null, coverForProject: null };
  const admin = fileVisibilityWhere({ id: "admin", roles: ["ADMIN"] });
  assert.equal(matches(file, admin), true);
  file.proposalMediaRetiredAt = new Date();
  assert.equal(matches(file, admin), false);
  file.coverForProject = project;
  assert.equal(matches(file, admin), true);
  file.coverForProject = null; file.sketchForProduct = product;
  assert.equal(matches(file, admin), true);
  assert.equal(matches(file, fileVisibilityWhere({ id: "other", roles: ["ENGINEER"] })), true);
  assert.equal(matches(file, fileVisibilityWhere({ id: "engineer", roles: ["ENGINEER"] })), true);
  project.stage = "LEAD";
  assert.equal(matches(file, fileVisibilityWhere({ id: "engineer", roles: ["ENGINEER"] })), false);
  project.deletedAt = new Date();
  assert.equal(matches(file, admin), false);
});
