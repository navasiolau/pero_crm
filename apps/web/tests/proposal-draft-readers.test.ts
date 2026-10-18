import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import { scopeNotificationContent } from "../src/server/access/notification-visibility";
import { resolveUploadContext } from "../src/server/files/upload-context";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";

const fixture = engineerFixture(), project = fixture.projects[0];
project.deletedAt = null;
const source = fixture.products[0];
const proposal = { id: "kp", projectId: project.id, project, deletedAt: null, isArchive: false };
const candidates: FixtureRow[] = [
  { id: "kp-linked", proposalItem: { deletedAt: null, proposal } },
  { id: "crm-only", proposalItem: null },
  { id: "kp-archived", proposalItem: { deletedAt: null, proposal: { ...proposal, isArchive: true } } },
  { id: "kp-deleted", proposalItem: { deletedAt: new Date(0), proposal } },
].map(candidate => ({ ...source, ...candidate, number: candidate.id, title: candidate.id, status: "DRAFT", deletedAt: null,
  project, projectId: project.id, tasks: [], files: [], works: [], percentageConfigs: [] }));
fixture.products.splice(0, fixture.products.length, ...candidates);
project.products = candidates;
const tasks: FixtureRow[] = candidates.map(product => {
  const work: FixtureRow = { id: `work-${product.id}`, product, productId: product.id, project, projectId: project.id,
    priceSnapshot: "1", total: "1", paymentKind: "LEGACY", tasks: [] };
  const task: FixtureRow = { ...fixture.tasks[0], id: `task-${product.id}`, product, productId: product.id, project, projectId: project.id,
    assigneeId: "engineer", quantity: "1", workId: work.id, work, dependencies: [] };
  work.tasks = [task]; product.tasks = [task]; product.works = [work];
  return task;
});
const files: FixtureRow[] = candidates.flatMap(product => [true, false].map(direct => ({
  id: `file-${product.id}-${direct}`, project, projectId: project.id, product: direct ? product : null,
  productId: direct ? product.id : null, taskId: direct ? null : `task-${product.id}`,
  task: direct ? null : tasks.find(task => task.productId === product.id), fileName: "document.pdf", mimeType: "application/pdf", createdAt: new Date(0),
})));
fixture.tasks.splice(0, fixture.tasks.length, ...tasks); project.tasks = fixture.tasks;
fixture.files.splice(0, fixture.files.length, ...files); project.files = files;
const db = { ...fixture.db, work: fixtureModel(candidates.flatMap(product => product.works as FixtureRow[])) } as unknown as PrismaClient;
const manager = { id: "manager", roles: ["MANAGER"] as Role[] };
let productQueries: typeof import("../src/server/products/queries"), projectQueries: typeof import("../src/server/projects/queries");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  productQueries = await import("../src/server/products/queries");
  projectQueries = await import("../src/server/projects/queries");
});

test("actual list, direct card, project children and select options expose only the linked draft", async () => {
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["MANAGER", "WORKER"]] as Role[][]) {
    const actor = { ...manager, roles };
    const list = await productQueries.listProducts(actor.id, roles, { activeOnly: false, statuses: ["DRAFT"] });
    assert.deepEqual(list.rows.map(row => row.id), ["kp-linked"]); assert.equal(list.total, 1);
    assert.equal(list.rows[0].canAccessDraft, true);
    const direct = await productQueries.getProductFor(actor.id, roles, "kp-linked"); assert.ok(direct);
    assert.equal(direct.canAccessDraft, true);
    assert.equal(direct.tasks[0].id, "task-kp-linked");
    for (const candidate of candidates.slice(1)) assert.equal(await productQueries.getProductFor(actor.id, roles, String(candidate.id)), null);
    assert.deepEqual((await productQueries.listProductOptions(String(project.id), actor)).map(row => row.id), ["kp-linked"]);
    const card = await projectQueries.getProjectFor(actor.id, roles, String(project.id)); assert.ok(card);
    assert.deepEqual(card.products.map(row => row.id), ["kp-linked"]);
    assert.equal(card.products[0].canAccessDraft, true);
    assert.deepEqual(card.tasks.map(row => row.id), ["task-kp-linked"]);
    assert.deepEqual(new Set(card.files.map(row => row.id)), new Set(["file-kp-linked-true", "file-kp-linked-false"]));
  }
});

test("upload preflight rejects a known unrelated sibling and task before storage writes", async () => {
  assert.equal((await resolveUploadContext(db, manager, { projectId: String(project.id), productId: "kp-linked", taskId: null }))?.productId, "kp-linked");
  assert.equal((await resolveUploadContext(db, manager, { projectId: String(project.id), productId: null, taskId: "task-kp-linked" }))?.productId, "kp-linked");
  for (const candidate of candidates.slice(1)) {
    assert.equal(await resolveUploadContext(db, manager, { projectId: String(project.id), productId: String(candidate.id), taskId: null }), null);
    assert.equal(await resolveUploadContext(db, manager, { projectId: String(project.id), productId: null, taskId: `task-${candidate.id}` }), null);
  }
});

test("manager notification content is checked per entity even inside a visible proposal project", async () => {
  const result = await scopeNotificationContent(manager, [
    { type: "product.statusChanged", title: "КП", body: "Доступно", link: "/products/kp-linked" },
    { type: "product.statusChanged", title: "Чужой черновик", body: "Приватно", link: "/products/crm-only" },
    { type: "task.assigned", title: "Черновая задача", body: "Приватно", link: "/tasks/task-crm-only" },
  ], db);
  assert.equal(result[0].body, "Доступно");
  for (const item of result.slice(1)) { assert.equal(item.body, null); assert.equal(item.link, "/my"); }
});

test("stable ID takes precedence over a colliding number alias and never falls through an inaccessible ID", async () => {
  const originalLength = fixture.products.length;
  const exact: FixtureRow = { ...candidates[0], id: "stable-choice", number: "another-number", status: "PREPARATION", proposalItem: null, tasks: [], files: [], works: [] };
  const alias: FixtureRow = { ...exact, id: "alias-owner", number: "stable-choice" };
  // Alias намеренно раньше ID: OR/findFirst вернул бы другое изделие.
  fixture.products.push(alias, exact);
  try {
    assert.equal((await productQueries.getProductFor(manager.id, manager.roles, "stable-choice"))?.id, "stable-choice");
    exact.deletedAt = new Date(0);
    assert.equal(await productQueries.getProductFor(manager.id, manager.roles, "stable-choice"), null);
    assert.equal((await productQueries.getProductFor(manager.id, manager.roles, "stable-choice-nonexistent")), null);
  } finally { fixture.products.splice(originalLength); }
});
