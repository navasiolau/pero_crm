import assert from "node:assert/strict";
import { test } from "node:test";
import type { Role } from "@prisma/client";
import { canAccessProductDraft, canViewProductDrafts, type ProductDraftAccessContext } from "../src/lib/product-drafts";
import { productEditWhere, productVisibilityWhere, fileVisibilityWhere, taskVisibilityWhere, workVisibilityWhere, canEditProductTechnicalBlock } from "../src/server/access/visibility";
import { visibleProductStatuses } from "../src/lib/product-statuses";
import { currentProductStatusTargets } from "../src/lib/product-percentage-ui";
import { canAddProductWork } from "../src/server/works/access";
import { canEditOrdinaryWork } from "../src/lib/ordinary-work-access";
import { canSetProductCover } from "../src/lib/product-cover";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

function linked(): ProductDraftAccessContext {
  return { projectId: "project", deletedAt: null, project: { id: "project", deletedAt: null },
    proposalItem: { deletedAt: null, proposal: { projectId: "project", deletedAt: null, isArchive: false,
      project: { id: "project", deletedAt: null } } } };
}
const manager = { id: "manager", roles: ["MANAGER"] as Role[] };

test("MANAGER grant is one live linked proposal item, never its draft siblings", () => {
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["MANAGER", "ACCOUNTANT"], ["MANAGER", "WORKER"]] as Role[][]) {
    assert.equal(canViewProductDrafts(roles), false);
    assert.equal(canAccessProductDraft(roles, linked()), true);
    assert.equal(canAccessProductDraft(roles), false);
    assert.equal(canAccessProductDraft(roles, { ...linked(), proposalItem: null }), false);
  }
  for (const roles of [["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    assert.equal(canViewProductDrafts(roles), true);
    assert.equal(canAccessProductDraft(roles), true);
  }
  for (const role of ["ENGINEER", "ACCOUNTANT", "PROCUREMENT", "WORKER", "MOUNTER", "WORK_COORDINATOR"] as Role[])
    assert.equal(canAccessProductDraft([role], linked()), false);
});

test("incomplete, archived, deleted and cross-project bindings fail closed", () => {
  const product = linked(), item = product.proposalItem!, proposal = item.proposal;
  const invalid: ProductDraftAccessContext[] = [
    { ...product, deletedAt: new Date(0) }, { ...product, project: { id: "project", deletedAt: new Date(0) } },
    { ...product, proposalItem: { ...item, deletedAt: new Date(0) } },
    { ...product, proposalItem: { ...item, proposal: { ...proposal, deletedAt: new Date(0) } } },
    { ...product, proposalItem: { ...item, proposal: { ...proposal, isArchive: true } } },
    { ...product, proposalItem: { ...item, proposal: { ...proposal, projectId: null } } },
    { ...product, proposalItem: { ...item, proposal: { ...proposal, projectId: "other" } } },
    { ...product, proposalItem: { ...item, proposal: { ...proposal, project: { id: "other", deletedAt: null } } } },
    {}, { projectId: "project", proposalItem: item },
  ];
  for (const context of invalid) assert.equal(canAccessProductDraft(manager.roles, context), false);
});

test("same relational predicate protects products, search, children and direct files", () => {
  const good = { ...linked(), id: "linked", status: "DRAFT" }, sibling = { ...linked(), id: "crm-only", status: "DRAFT", proposalItem: null };
  const invalid = [sibling,
    { ...good, proposalItem: { ...good.proposalItem!, deletedAt: new Date(0) } },
    { ...good, proposalItem: { ...good.proposalItem!, proposal: { ...good.proposalItem!.proposal, isArchive: true } } },
    { ...good, proposalItem: { ...good.proposalItem!, proposal: { ...good.proposalItem!.proposal, deletedAt: new Date(0) } } },
  ];
  for (const product of [good, ...invalid]) {
    const allowed = product === good;
    assert.equal(matches(product, productVisibilityWhere(manager) as FixtureRow), allowed);
    assert.equal(matches(product, productEditWhere(manager) as FixtureRow), allowed);
    const child = { id: "child", project: product.project, productId: product.id, product };
    assert.equal(matches(child, taskVisibilityWhere(manager) as FixtureRow), allowed);
    assert.equal(matches(child, workVisibilityWhere(manager) as FixtureRow), allowed);
    assert.equal(matches({ ...child, taskId: null, task: null }, fileVisibilityWhere(manager) as FixtureRow), allowed);
  }
  const validChild = { id: "child", project: good.project, productId: good.id, product: good };
  assert.equal(matches({ ...validChild, taskId: "foreign-task", task: { ...validChild, productId: sibling.id, product: sibling } }, fileVisibilityWhere(manager) as FixtureRow), false);
  assert.equal(matches({ ...validChild, productId: null, product: null, taskId: "linked-task", task: validChild }, fileVisibilityWhere(manager) as FixtureRow), true);
});

test("technical edits, covers and ordinary works use per-product draft context", () => {
  const product = { ...linked(), id: "linked", status: "DRAFT" as const, engineerId: null, sketchFileId: null, projectId: "project" };
  for (const candidate of [product, { ...product, proposalItem: null }]) {
    const allowed = candidate === product;
    assert.equal(canEditProductTechnicalBlock(manager, candidate), allowed);
    assert.equal(canSetProductCover(manager, candidate), allowed);
    assert.equal(canAddProductWork(manager.roles, candidate.status, candidate), allowed);
    assert.equal(canEditOrdinaryWork(manager.roles, candidate.status, candidate), allowed);
  }
});

test("safe UI grant exposes linked drafts while pre-contract transition lock remains", () => {
  assert.equal(visibleProductStatuses(manager.roles).some(status => status.id === "DRAFT"), false);
  assert.equal(visibleProductStatuses(manager.roles, true).some(status => status.id === "DRAFT"), true);
  assert.equal(visibleProductStatuses(["ENGINEER"], true).some(status => status.id === "DRAFT"), false);
  const product = { status: "DRAFT" as const, engineerId: null, canAccessDraft: true };
  for (const projectStage of ["LEAD", "ESTIMATE"] as const)
    assert.deepEqual(currentProductStatusTargets(manager.roles, { ...product, projectStage }), []);
  assert.ok(currentProductStatusTargets(manager.roles, { ...product, projectStage: "CONTRACT" }).includes("PREPARATION"));
  assert.deepEqual(currentProductStatusTargets(manager.roles, { ...product, canAccessDraft: false, projectStage: "CONTRACT" }), []);
});
