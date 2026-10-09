import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import { canEditProductTechnicalBlock, fileVisibilityWhere, productEditWhere, productVisibilityWhere, taskExecutionWhere, taskVisibilityWhere, workVisibilityWhere } from "../src/server/access/visibility";
import { decideProductPercentageStatus } from "../src/lib/product-percentage-status";
import { productStatusTargets } from "../src/lib/product-percentage-ui";
import { scopeNotificationContent } from "../src/server/access/notification-visibility";
import { engineerFixture, matches } from "./helpers/visibility-fixture";

const fixture = engineerFixture();
const draft = fixture.products[0];
draft.status = "DRAFT";
for (const product of fixture.products) product.quantity = 1;
const actorId = "engineer";
const rolesWithoutDraft: Role[][] = [
  ["MANAGER"], ["MANAGER", "ENGINEER"], ["MANAGER", "WORKER"], ["ENGINEER"],
  ["ACCOUNTANT"], ["PROCUREMENT"], ["WORKER"], ["MOUNTER"], ["ACCOUNTANT", "ENGINEER"],
];
let products: typeof import("../src/server/products/queries");
let projects: typeof import("../src/server/projects/queries");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = fixture.db as unknown as PrismaClient;
  products = await import("../src/server/products/queries");
  projects = await import("../src/server/projects/queries");
});

test("DRAFT visibility/edit and technical block are limited to ADMIN/DIRECTOR despite assignments or role union", () => {
  for (const roles of [...rolesWithoutDraft, ["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    const actor = { id: actorId, roles, engineeringParticipantProductIds: [String(draft.id)], fieldParticipantProductIds: [String(draft.id)] };
    const allowed = roles.includes("ADMIN") || roles.includes("DIRECTOR");
    assert.equal(matches(draft, productVisibilityWhere(actor)), allowed, roles.join("+") + " read");
    assert.equal(matches(draft, productEditWhere(actor)), allowed, roles.join("+") + " edit");
    assert.equal(canEditProductTechnicalBlock(actor, { id: String(draft.id), engineerId: actorId, status: "DRAFT" }), allowed);
  }
});

test("DRAFT tasks, works and direct or task-only files are private, shared project files retain normal grants", () => {
  const task = fixture.tasks[0];
  const work = { deletedAt: null, productId: draft.id, product: draft, project: fixture.projects[0], tasks: [task], paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null };
  const files = [
    { ...fixture.files[0], uploadedById: actorId },
    { ...fixture.files[3], taskId: task.id, task, uploadedById: actorId },
  ];
  for (const roles of [...rolesWithoutDraft, ["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    const actor = { id: actorId, roles, engineeringParticipantTaskIds: [String(task.id)] };
    const allowed = roles.includes("ADMIN") || roles.includes("DIRECTOR");
    assert.equal(matches(task, taskVisibilityWhere(actor)), allowed, roles.join("+") + " task");
    assert.equal(matches(task, taskExecutionWhere(actor)), allowed, roles.join("+") + " execution");
    assert.equal(matches(work, workVisibilityWhere(actor)), allowed, roles.join("+") + " work");
    for (const file of files) assert.equal(matches(file, fileVisibilityWhere(actor)), allowed, roles.join("+") + " file");
  }
  assert.equal(matches(fixture.files[3], fileVisibilityWhere({ id: actorId, roles: ["MANAGER"] })), true);
});

test("manager product queries, persisted DRAFT filter, direct key and nested project cannot disclose draft; aggregate stays equal", async () => {
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"]] as Role[][]) {
    const result = await products.listProducts(actorId, roles, { activeOnly: false });
    assert.equal(result.rows.some(row => row.id === draft.id), false);
    assert.equal(result.total, 4);
    assert.equal((await products.listProducts(actorId, roles, { activeOnly: false, statuses: ["DRAFT"] })).total, 0);
    for (const key of [String(draft.id), String(draft.number)]) assert.equal(await products.getProductFor(actorId, roles, key), null);
    const project = await projects.getProjectFor(actorId, roles, "mixed");
    assert.ok(project);
    assert.deepEqual(project.products.map(row => row.id), ["foreign", "production"]);
    const summary = (await projects.listProjects(actorId, roles, { activeOnly: false })).rows.find(row => row.id === "mixed")!;
    assert.equal(summary._count.products, 2);
    assert.equal(summary.totalPrice, 667266);
    assert.equal(JSON.stringify(summary.products).includes('"own"'), false);
  }
  for (const roles of [["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    assert.ok(await products.getProductFor(actorId, roles, String(draft.id)));
    assert.equal((await products.listProducts(actorId, roles, { activeOnly: false, statuses: ["DRAFT"] })).total, 1);
  }
});

test("a manager cannot restore/leave or no-op DRAFT through status API; confirmed normal statuses keep usual grants", () => {
  const context = { assignedEngineer: true, participant: true, hasB3d: false, noModel: false };
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"]] as Role[][]) {
    for (const [from, to] of [["DRAFT", "PREPARATION"], ["DRAFT", "DRAFT"], ["PREPARATION", "DRAFT"]] as const)
      assert.equal(decideProductPercentageStatus(roles, { ...context, from, to }).allowed, false);
    assert.equal(decideProductPercentageStatus(roles, { ...context, from: "PREPARATION", to: "DESIGN" }).allowed, true);
    assert.equal(productStatusTargets(roles, { ...context, from: "PREPARATION", projectStage: "CONTRACT" }).includes("DRAFT"), false);
  }
});

test("manager notification content cannot reveal draft while unrelated full project messages retain content", async () => {
  const items = [
    { type: "product.statusChanged", title: "Черновой шкаф", body: "Secret", link: "/products/own" },
    { type: "project.stageChanged", title: "Договор", body: "Normal", link: "/projects/mixed" },
  ];
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"]] as Role[][]) {
    const result = await scopeNotificationContent({ id: actorId, roles }, items, fixture.db as unknown as PrismaClient);
    assert.equal(JSON.stringify(result[0]).includes("Черновой шкаф"), false);
    assert.deepEqual(result[1], items[1]);
  }
});

test("contract promotion immediately restores ordinary manager access without altering price/quantity", async () => {
  const before = { price: draft.expectedPrice, quantity: draft.quantity };
  draft.status = "PREPARATION";
  try {
    const product = await products.getProductFor(actorId, ["MANAGER", "ENGINEER"], String(draft.id));
    assert.ok(product);
    assert.equal(product.expectedPrice, before.price);
    assert.equal(product.quantity, before.quantity);
  } finally { draft.status = "DRAFT"; }
});

test("known DRAFT material IDs and stock issue cannot reach plan, valuation or quantity writes", async () => {
  const { addMaterialNorm, updateMaterialNorm, lockMaterialProduct } = await import("../src/server/warehouse/norm-core");
  const { warehouseMove } = await import("../src/server/warehouse/accounting");
  const privateProduct = { ...draft, project: fixture.projects[0] };
  const line = { id: "line", productId: draft.id, product: privateProduct };
  let forbiddenCalls = 0;
  const stop = async () => { forbiddenCalls++; throw Error("PRIVATE_BUSINESS_READ_OR_WRITE"); };
  const tx = {
    $queryRaw: async () => [],
    warehouseAccountingState: { findUnique: async () => ({ phase: "ACTIVE", runId: "run" }) },
    product: { findUnique: async ({ where }: { where: Record<string, unknown> }) => matches(privateProduct, where) ? privateProduct : null },
    projectMaterial: { findUnique: async ({ where }: { where: Record<string, unknown> }) => matches(line, where) ? line : null, update: stop, upsert: stop },
    material: { findUnique: stop },
    warehouseMovementValuation: { findUnique: async () => null, create: stop },
    stockMovement: { create: stop },
  } as unknown as import("@prisma/client").Prisma.TransactionClient;
  const actor = { id: actorId, roles: ["MANAGER", "ENGINEER"] as Role[] };
  await assert.rejects(addMaterialNorm(tx, { productId: String(draft.id), materialId: "material", quantity: 1 }, actor), /Изделие не найдено/);
  await assert.rejects(updateMaterialNorm(tx, { id: "line", quantity: 1 }, actor), /Строка потребности не найдена/);
  await assert.rejects(lockMaterialProduct(tx, "line", actor), /Строка потребности не найдена/);
  await assert.rejects(warehouseMove(tx, actor, { kind: "EXPENSE", productId: String(draft.id), materialId: "material", quantity: "1", clientMutationId: "00000000-0000-4000-8000-000000000002" }), /Изделие не найдено/);
  assert.equal(forbiddenCalls, 0);
  assert.equal(draft.expectedPrice, 100);
  assert.equal(draft.quantity, 1);
});
