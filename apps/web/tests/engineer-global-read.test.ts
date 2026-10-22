import assert from "node:assert/strict";
import { test } from "node:test";
import type { Role } from "@prisma/client";
import { canEditProductTechnicalBlock, fileVisibilityWhere, hasFullProjectVisibility, productEditWhere, productVisibilityWhere, projectVisibilityWhere, taskExecutionWhere, taskVisibilityWhere } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

const engineer = { id: "engineer", roles: ["ENGINEER"] as Role[] };
const project = { id: "contract", stage: "CONTRACT", deletedAt: null, products: [], tasks: [] };
const product = { id: "foreign", projectId: project.id, project, status: "DESIGN" as const, engineerId: "other", deletedAt: null };

test("engineer global read includes empty accepted projects and later products only under an accepted parent", () => {
  for (const stage of ["CONTRACT", "IN_WORK", "DONE"]) {
    assert.equal(matches({ ...project, stage, products: [] }, projectVisibilityWhere(engineer)), true, stage);
  }
  for (const stage of ["LEAD", "ESTIMATE", "REFUSED"]) {
    assert.equal(matches({ ...project, stage, products: [product] }, projectVisibilityWhere(engineer)), false, stage);
    assert.equal(matches({ ...product, project: { ...project, stage }, engineerId: engineer.id }, productVisibilityWhere(engineer)), false, stage);
  }
  for (const status of ["DESIGN", "PRODUCTION", "STORAGE", "INSTALLATION", "DONE"]) {
    assert.equal(matches({ ...product, status }, productVisibilityWhere(engineer)), true, status);
  }
  for (const status of ["DRAFT", "PREPARATION"]) assert.equal(matches({ ...product, status }, productVisibilityWhere(engineer)), false, status);
  assert.equal(matches({ ...product, project: { ...project, deletedAt: new Date() } }, productVisibilityWhere(engineer)), false);
  assert.equal(matches({ ...product, deletedAt: new Date() }, productVisibilityWhere(engineer)), false);
});

test("global read keeps technical edit, assignment, execution and independent role grants separate", () => {
  assert.equal(matches(product, productVisibilityWhere(engineer)), true);
  assert.equal(hasFullProjectVisibility(engineer), false);
  assert.equal(matches(product, productEditWhere(engineer)), false);
  assert.equal(canEditProductTechnicalBlock(engineer, product), false);
  assert.equal(matches({ id: "foreign-task", productId: product.id, product, project, assigneeId: "other" }, taskExecutionWhere(engineer)), false);
  assert.equal(matches({ ...product, engineerId: engineer.id }, productEditWhere(engineer)), true);
  assert.equal(matches({ ...product, status: "STORAGE", engineerId: engineer.id }, productEditWhere(engineer)), false);
  assert.equal(matches(product, productVisibilityWhere({ ...engineer, roles: ["ACCOUNTANT"] })), false);
  assert.equal(matches(product, productVisibilityWhere({ ...engineer, roles: ["ENGINEER", "ACCOUNTANT"] })), true);
  const leadProduct = { ...product, project: { ...project, stage: "LEAD" } };
  assert.equal(matches(leadProduct, productVisibilityWhere({ ...engineer, roles: ["ENGINEER", "MANAGER"] })), true);
  assert.equal(matches({ ...leadProduct, status: "PRODUCTION" }, productVisibilityWhere({ ...engineer, roles: ["ENGINEER", "WORKER"] })), true);
  const ownTask = { id: "own-task", assigneeId: engineer.id, productId: product.id, project, product: { ...product, engineerId: engineer.id } };
  assert.equal(matches(ownTask, taskVisibilityWhere(engineer)), true);
  const hiddenTask = { ...ownTask, project: leadProduct.project, product: { ...leadProduct, engineerId: engineer.id } };
  assert.equal(matches(hiddenTask, taskVisibilityWhere(engineer)), false);
  assert.equal(matches(hiddenTask, taskVisibilityWhere({ ...engineer, roles: ["ENGINEER", "MANAGER"] })), true);
  assert.equal(matches({ ...hiddenTask, product: { ...hiddenTask.product, status: "PRODUCTION" } }, taskVisibilityWhere({ ...engineer, roles: ["ENGINEER", "WORKER"] })), true);
});

test("ordinary technical task files use visible parents without inheriting task execution", () => {
  const task: FixtureRow = { id: "task", project, product, productId: product.id, assigneeId: "other" };
  const file = { project, product, productId: product.id, taskId: "task", task };
  for (const section of ["GENERAL", "MEASUREMENT", "PRODUCTION", "INSTALLATION"]) {
    assert.equal(matches({ ...file, section }, fileVisibilityWhere(engineer)), true, section);
  }
  assert.equal(matches({ ...file, section: "GENERAL", productId: null, product: null }, fileVisibilityWhere(engineer)), true);
  assert.equal(matches({ ...file, section: "GENERAL", productId: null, product: null, taskId: null, task: null }, fileVisibilityWhere(engineer)), true);
  assert.equal(matches({ ...file, section: "GENERAL", task: { ...task, product: { ...product, status: "PREPARATION" } } }, fileVisibilityWhere(engineer)), false);
  assert.equal(matches({ ...file, section: "GENERAL", product: { ...product, status: "PREPARATION" } }, fileVisibilityWhere(engineer)), false);
  assert.equal(matches({ ...file, section: "GENERAL", task: { ...task, project: { ...project, stage: "LEAD" } } }, fileVisibilityWhere(engineer)), false);
  assert.equal(matches({ ...file, section: "GENERAL", proposalMediaRetiredAt: new Date() }, fileVisibilityWhere(engineer)), false);
});
